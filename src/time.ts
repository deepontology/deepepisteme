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
 *
 * What certainty means
 * --------------------
 *   an interval is CERTAINLY active at t when every reading of the evidence
 *   places it active at t: t is inside the confident start core and no later
 *   than the certainty horizon. POSSIBLY active means some reading does.
 *
 *   The certainty horizon is `lastObserved`: the latest instant at which the
 *   interval is positively observed active. It is the end bound for a known
 *   end, the verification instant for `verified:`, the confirming observation
 *   for `ongoing`, and the latest possible start for `?` (a start with no end
 *   is one observation, not six years of them).
 *
 *   Invariant, checked by the generated property tests: certain(t) implies
 *   possible(t) for every interval and every t. Nothing is asserted after the
 *   dataset cutoff.
 *
 * Month-only observations
 * -----------------------
 *   `verified:2025-12` establishes presence at the month midpoint for
 *   certainty, and does not auto-extend that certainty to the last day of the
 *   month. The month's end remains possible, not certain.
 *
 * Ongoing confirmation
 * --------------------
 *   `ongoing` means positively confirmed in place at the cutoff. That requires
 *   an observation dated within ONGOING_CONFIRMATION_DAYS of the cutoff. A
 *   record whose last observation is older is downgraded to `last-verified` at
 *   build time (with a warning), and certainty stops at the observation.
 */

import { getParameters } from './parameters.ts';

let DATASET_CUTOFF = Date.UTC(2026, 5, 1); // 2026-06-01 default (Ruritania)
let DATASET_FLOOR = Date.UTC(1900, 0, 1);
let BEFORE_WINDOW_YEARS = 8;
let BEFORE_WINDOW_MS = 8 * 365.2425 * 86_400_000;
let APPROX_SLACK_DAYS: { year: number; month: number } = { year: 365, month: 92 };

/** How recent an observation must be for `ongoing` to remain certain at cutoff. */
export const ONGOING_CONFIRMATION_DAYS = 90;

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
  /**
   * Latest instant at which the interval is positively observed active. The
   * certainty horizon: `certainlyActive` never returns true after it. Null only
   * for an unconfirmed `ongoing` interval, which the build resolves before
   * emission.
   */
  lastObserved: number | null;
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
  // The certainty horizon is finalized after the clamps below, because a clamp
  // can move a known end up to the start.
  let observed: number | null;

  const endToken = (rawEnd ?? '?').trim();

  if (endToken === 'ongoing') {
    endEarliest = null;
    endLatest = null;
    endPrecision = 'after';
    status = 'ongoing';
    observed = null;
  } else if (endToken.startsWith('verified:')) {
    const at = parseDateEdge(endToken.slice('verified:'.length));
    // Month-only observation: certainty at the month midpoint, not its last
    // day. A day-precision verification observes that day exactly.
    const instant = at.precision === 'month' ? Math.floor((at.earliest + at.latest) / 2) : at.latest;
    endEarliest = Math.min(at.latest, DATASET_CUTOFF);
    endLatest = DATASET_CUTOFF;
    endPrecision = at.precision;
    status = 'last-verified';
    observed = Math.min(instant, DATASET_CUTOFF);
  } else if (endToken === '?') {
    endEarliest = null;
    endLatest = DATASET_CUTOFF;
    endPrecision = 'unknown';
    status = 'unknown';
    observed = null;
  } else {
    const e = parseDateEdge(endToken);
    endEarliest = e.earliest;
    endLatest = e.latest;
    endPrecision = e.precision;
    status = 'ended';
    observed = e.earliest;
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

  // Finalize the certainty horizon from the post-clamp values. An unknown end
  // has exactly one observation: the latest instant the start can fall on.
  let lastObserved: number | null;
  if (status === 'ongoing') lastObserved = null;
  else if (status === 'unknown') lastObserved = start.latest;
  else if (status === 'last-verified') lastObserved = observed;
  else lastObserved = endEarliest;

  return {
    startEarliest: start.earliest,
    startLatest: start.latest,
    endEarliest,
    endLatest,
    startPrecision: start.precision,
    endPrecision,
    status,
    lastObserved,
    ...(trimmed ? { trimmed: true } : {}),
    ...(startClamped ? { startClamped: true } : {}),
    raw: { start: rawStart, end: rawEnd }
  };
}

/**
 * Resolve an `ongoing` interval against its latest observation.
 *
 * Confirmed: the observation is within ONGOING_CONFIRMATION_DAYS of the cutoff,
 * `ongoing` stands, and certainty runs through the observation.
 *
 * Otherwise the status is downgraded to `last-verified`: certainty stops at the
 * observation (never before the start), and the envelope opens to the cutoff.
 * The build warns when this happens; it is never silent.
 */
export function applyOngoingObservation(
  iv: ResolvedInterval,
  lastObservation: number | null
): ResolvedInterval {
  if (iv.status !== 'ongoing') return iv;
  const cutoff = DATASET_CUTOFF;
  const recent =
    lastObservation !== null &&
    lastObservation >= cutoff - ONGOING_CONFIRMATION_DAYS * 86_400_000;
  if (recent) {
    return { ...iv, lastObserved: Math.min(lastObservation, cutoff) };
  }
  const observed = Math.min(Math.max(iv.startLatest, lastObservation ?? iv.startLatest), cutoff);
  return {
    ...iv,
    status: 'last-verified',
    endEarliest: observed,
    endLatest: cutoff,
    endPrecision: iv.endPrecision === 'after' ? 'unknown' : iv.endPrecision,
    lastObserved: observed
  };
}

/** True when the interval is definitely active at `t` (inside the confident core). */
export function certainlyActive(iv: ResolvedInterval, t: number): boolean {
  // Nothing is asserted after the cutoff; certainty stops at the horizon.
  if (t > DATASET_CUTOFF) return false;
  if (t < iv.startLatest) return false;
  const coreEnd =
    iv.endEarliest !== null
      ? iv.lastObserved !== null
        ? Math.min(iv.endEarliest, iv.lastObserved)
        : iv.endEarliest
      : iv.lastObserved;
  if (coreEnd !== null && t > coreEnd) return false;
  return true;
}

/** True when the interval may be active at `t` (inside the outer envelope). */
export function possiblyActive(iv: ResolvedInterval, t: number): boolean {
  if (t > DATASET_CUTOFF) return false;
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
export function getBeforeWindowYears(): number {
  return BEFORE_WINDOW_YEARS;
}
export function getApproxSlackDays(): { year: number; month: number } {
  return { ...APPROX_SLACK_DAYS };
}
