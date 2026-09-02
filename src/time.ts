/**
 * time.ts — fuzzy interval resolver and predicates.
 *
 * Historical dates are rarely precise. A source may say "appointed 1 June 2018",
 * or "in post by at least December 2025", or "around 2017". Collapsing all of
 * those into a single timestamp invents precision. Every date edge resolves to a
 * RANGE (earliest, latest) plus a precision label, and every interval carries a
 * status describing what is known about its end. The UI renders that uncertainty
 * rather than hiding it.
 *
 * Grammar
 * -------
 *   2018-06-01        exact day
 *   2018-06           some time in June 2018
 *   2018              some time in 2018
 *   ~2017             approximately 2017 (widened ±1 year by default)
 *   ~2017-06          approximately June 2017 (widened ±3 months by default)
 *   <=2018-06         no later than June 2018 (already in place by then)
 *   >=1984            no earlier than 1984
 *   ongoing           still in place at the dataset cutoff, positively confirmed
 *   verified:2025-12  documented in place at this date; may have continued after
 *   ?                 unknown
 */

import { getParameters } from './config.ts';

let DATASET_CUTOFF = Date.UTC(2026, 5, 1); // 2026-06-01 default (Ruritania)
let DATASET_FLOOR = Date.UTC(1900, 0, 1);
let BEFORE_WINDOW_YEARS = 8;
let BEFORE_WINDOW_MS = 8 * 365.2425 * 86_400_000;
let APPROX_SLACK_DAYS: { year: number; month: number } = { year: 365, month: 92 };

export function configureTime(p: {
  floor: string;
  cutoff: string;
  beforeWindowYears: number;
  approxSlackDays: { year: number; month: number };
}): void {
  const floor = parseBare(p.floor);
  const cutoff = parseBare(p.cutoff);
  if (floor.precision !== 'day' || cutoff.precision !== 'day') {
    throw new Error('parameters.time floor and cutoff must be day-precision dates');
  }
  DATASET_FLOOR = floor.earliest;
  DATASET_CUTOFF = cutoff.latest;
  BEFORE_WINDOW_YEARS = p.beforeWindowYears;
  BEFORE_WINDOW_MS = p.beforeWindowYears * 365.2425 * 86_400_000;
  APPROX_SLACK_DAYS = p.approxSlackDays;
}

export function configureTimeFromActive(): void {
  const p = getParameters();
  configureTime(p.time);
}

export type Precision = 'day' | 'month' | 'year' | 'approx' | 'before' | 'after' | 'unknown';
export type IntervalStatus = 'ended' | 'ongoing' | 'last-verified' | 'unknown';

export interface ResolvedInterval {
  startEarliest: number;
  startLatest: number;
  endEarliest: number | null;
  endLatest: number | null;
  startPrecision: Precision;
  endPrecision: Precision;
  status: IntervalStatus;
  trimmed?: boolean;
  startClamped?: boolean;
  raw: { start: string | null; end: string | null };
}

interface Edge {
  earliest: number;
  latest: number;
  precision: Precision;
}

const YMD = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

function startOfYear(y: number) {
  return Date.UTC(y, 0, 1);
}
function endOfYear(y: number) {
  return Date.UTC(y, 11, 31, 23, 59, 59);
}
function startOfMonth(y: number, m: number) {
  return Date.UTC(y, m - 1, 1);
}
function endOfMonth(y: number, m: number) {
  return Date.UTC(y, m, 0, 23, 59, 59);
}

function parseBare(token: string): Edge {
  const m = YMD.exec(token);
  if (!m) throw new Error(`Unparseable date token: "${token}"`);
  const year = Number(m[1]);
  if (m[3] !== undefined) {
    const mo = Number(m[2]);
    const da = Number(m[3]);
    if (mo < 1 || mo > 12) throw new Error(`Invalid month in "${token}"`);
    const t = Date.UTC(year, mo - 1, da);
    const d = new Date(t);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) {
      throw new Error(`Invalid calendar date: "${token}"`);
    }
    return { earliest: t, latest: t, precision: 'day' };
  }
  if (m[2] !== undefined) {
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) throw new Error(`Invalid month in "${token}"`);
    return { earliest: startOfMonth(year, mo), latest: endOfMonth(year, mo), precision: 'month' };
  }
  return { earliest: startOfYear(year), latest: endOfYear(year), precision: 'year' };
}

export function parseDateEdge(input: string): Edge {
  const token = input.trim();
  if (token === '?' || token === '') {
    return { earliest: DATASET_FLOOR, latest: DATASET_CUTOFF, precision: 'unknown' };
  }
  if (token.startsWith('~')) {
    const base = parseBare(token.slice(1).trim());
    const slack = base.precision === 'year' ? APPROX_SLACK_DAYS.year : APPROX_SLACK_DAYS.month;
    const ms = slack * 86_400_000;
    return { earliest: base.earliest - ms, latest: base.latest + ms, precision: 'approx' };
  }
  if (token.startsWith('<=')) {
    const base = parseBare(token.slice(2).trim());
    return {
      earliest: Math.max(DATASET_FLOOR, base.latest - BEFORE_WINDOW_MS),
      latest: base.latest,
      precision: 'before'
    };
  }
  if (token.startsWith('>=')) {
    const base = parseBare(token.slice(2).trim());
    return {
      earliest: base.earliest,
      latest: Math.min(DATASET_CUTOFF, base.earliest + BEFORE_WINDOW_MS),
      precision: 'after'
    };
  }
  return parseBare(token);
}

export function resolveInterval(
  spec: { start?: string | null; end?: string | null },
  opts?: { allowEnvelopeTrim?: boolean }
): ResolvedInterval {
  const rawStart = spec.start ?? null;
  const rawEnd = spec.end ?? null;
  let trimmed = false;
  let startClamped = false;

  let start = rawStart
    ? parseDateEdge(rawStart)
    : { earliest: DATASET_FLOOR, latest: DATASET_CUTOFF, precision: 'unknown' as Precision };

  let endEarliest: number | null;
  let endLatest: number | null;
  let endPrecision: Precision;
  let status: IntervalStatus;

  const endToken = (rawEnd ?? '?').trim();

  if (endToken === 'ongoing') {
    endEarliest = null;
    endLatest = null;
    endPrecision = 'after';
    status = 'ongoing';
  } else if (endToken.startsWith('verified:')) {
    const at = parseDateEdge(endToken.slice('verified:'.length));
    endEarliest = Math.min(at.latest, DATASET_CUTOFF);
    endLatest = DATASET_CUTOFF;
    endPrecision = at.precision;
    status = 'last-verified';
  } else if (endToken === '?') {
    endEarliest = null;
    endLatest = DATASET_CUTOFF;
    endPrecision = 'unknown';
    status = 'unknown';
  } else {
    const e = parseDateEdge(endToken);
    endEarliest = e.earliest;
    endLatest = e.latest;
    endPrecision = e.precision;
    status = 'ended';
  }

  if (endLatest !== null && endLatest < start.earliest && !opts?.allowEnvelopeTrim) {
    throw new Error(`Interval ends before it begins: start="${rawStart}" end="${rawEnd}"`);
  }
  if (endLatest !== null && start.latest > endLatest && !opts?.allowEnvelopeTrim) {
    start = { ...start, latest: endLatest };
    startClamped = true;
  }
  if (endEarliest !== null && endEarliest < start.latest && !opts?.allowEnvelopeTrim) {
    endEarliest = start.latest;
    trimmed = true;
  }

  return {
    startEarliest: start.earliest,
    startLatest: start.latest,
    endEarliest,
    endLatest,
    startPrecision: start.precision,
    endPrecision,
    status,
    ...(trimmed ? { trimmed: true } : {}),
    ...(startClamped ? { startClamped: true } : {}),
    raw: { start: rawStart, end: rawEnd }
  };
}

/** True when the interval is definitely active at t (inside the confident core). */
export function certainlyActive(iv: ResolvedInterval, t: number): boolean {
  if (t < iv.startLatest) return false;
  if (iv.endEarliest !== null && t > iv.endEarliest) return false;
  return true;
}

/** True when the interval may be active at t (inside the outer envelope). */
export function possiblyActive(iv: ResolvedInterval, t: number): boolean {
  if (t < iv.startEarliest) return false;
  if (iv.endLatest !== null && t > iv.endLatest) return false;
  return true;
}

export function durationYears(iv: ResolvedInterval): number {
  const startMid = (iv.startEarliest + iv.startLatest) / 2;
  const endMid =
    iv.endEarliest === null || iv.endLatest === null
      ? DATASET_CUTOFF
      : (iv.endEarliest + iv.endLatest) / 2;
  return Math.max(0, (endMid - startMid) / (365.2425 * 86_400_000));
}

export function getCutoff(): number {
  return DATASET_CUTOFF;
}
export function getFloor(): number {
  return DATASET_FLOOR;
}
