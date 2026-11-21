/**
 * kernel/time.ts: fuzzy interval resolver and predicates, self-contained.
 *
 * Historical dates are rarely precise. A source may say "appointed 1 June 2018",
 * or "in post by at least December 2025", or "around 2017". Every date edge
 * resolves to a RANGE (earliest, latest) plus a precision label, and every
 * interval carries a status describing what is known about its end. The UI
 * renders that uncertainty rather than hiding it.
 *
 * Grammar
 * -------
 *   2018-06-01        exact day
 *   2018-06           some time in June 2018
 *   2018              some time in 2018
 *   ~2017             approximately 2017 (widened by approxSlackDays.year)
 *   ~2017-06          approximately June 2017 (widened by approxSlackDays.month)
 *   <=2018-06         no later than June 2018 (already in place by then)
 *   >=1984            no earlier than 1984
 *   ongoing           still in place at the dataset cutoff, positively confirmed
 *   verified:2025-12  documented in place at this date; may have continued after
 *   ?                 unknown
 *
 * Certainty
 * ---------
 *   An interval is CERTAINLY active at t when every reading of the evidence
 *   places it active at t: t is inside the confident start core and no later
 *   than the certainty horizon. POSSIBLY active means some reading does.
 *
 *   The horizon is `lastObserved`: the latest instant at which the interval is
 *   positively observed active. Invariant, checked by property tests:
 *   certain(t) implies possible(t) for every interval and every t, and nothing
 *   is asserted after the cutoff.
 *
 * No module state
 * ---------------
 *   createTime() holds floor, cutoff, before window and slack in a closure.
 *   Two Time objects in one process never see each other. This module imports
 *   nothing, so a browser bundle that needs dates pulls in nothing else.
 */

/** What configureTime used to set, now a value held by one Time object. */
export interface TimeParameters {
  /** Day-precision, e.g. '1956-03-20'. */
  floor: string;
  /** Day-precision. */
  cutoff: string;
  beforeWindowYears: number;
  approxSlackDays: { year: number; month: number };
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
   * certainty horizon: certainlyActive never returns true after it. Null only
   * for an unconfirmed `ongoing` interval, which the build resolves before
   * emission.
   */
  lastObserved: number | null;
  trimmed?: boolean;
  startClamped?: boolean;
  raw: { start: string | null; end: string | null };
}

/** One resolved date edge: the range a token stands for, plus its precision. */
export interface DateEdge {
  earliest: number;
  latest: number;
  precision: Precision;
}

export interface ResolveOptions {
  allowEnvelopeTrim?: boolean;
}

/** Returned by createTime(). Pure: same input, same output, no hidden clock. */
export interface Time {
  readonly cutoff: number;
  readonly floor: number;
  readonly beforeWindowYears: number;
  readonly approxSlackDays: { readonly year: number; readonly month: number };
  /** One date token. No token resolves differently at the start or the end of an interval. */
  parseDateEdge(token: string): DateEdge;
  resolveInterval(start?: string, end?: string, opts?: ResolveOptions): ResolvedInterval;
  applyOngoingObservation(i: ResolvedInterval, lastObserved: number | null): ResolvedInterval;
  certainlyActive(i: ResolvedInterval, at: number): boolean;
  possiblyActive(i: ResolvedInterval, at: number): boolean;
  durationYears(i: ResolvedInterval): number;
}

/** How recent an observation must be for `ongoing` to remain certain at cutoff. */
export const ONGOING_CONFIRMATION_DAYS = 90;

const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = 365.2425 * MS_PER_DAY;
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

function parseBare(token: string): DateEdge {
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

/**
 * Build one self-contained time model. Throws on parameters that cannot be a
 * time model at all (a bad floor or cutoff date, a non-positive window): that
 * is a programming error, not a data finding.
 */
export function createTime(p: TimeParameters): Time {
  const floorEdge = parseBare(p.floor);
  const cutoffEdge = parseBare(p.cutoff);
  if (floorEdge.precision !== 'day' || cutoffEdge.precision !== 'day') {
    throw new Error('time parameters: floor and cutoff must be day-precision dates');
  }
  if (!(p.beforeWindowYears > 0)) {
    throw new Error('time parameters: beforeWindowYears must be positive');
  }
  if (!(p.approxSlackDays.year > 0) || !(p.approxSlackDays.month > 0)) {
    throw new Error('time parameters: approxSlackDays must be positive');
  }

  const DATASET_FLOOR = floorEdge.earliest;
  const DATASET_CUTOFF = cutoffEdge.latest;
  const BEFORE_WINDOW_YEARS = p.beforeWindowYears;
  const BEFORE_WINDOW_MS = p.beforeWindowYears * MS_PER_YEAR;
  const APPROX_SLACK_DAYS = { year: p.approxSlackDays.year, month: p.approxSlackDays.month };

  function parseDateEdge(input: string): DateEdge {
    const token = input.trim();
    if (token === '?' || token === '') {
      return { earliest: DATASET_FLOOR, latest: DATASET_CUTOFF, precision: 'unknown' };
    }
    if (token.startsWith('~')) {
      const base = parseBare(token.slice(1).trim());
      const slack = base.precision === 'year' ? APPROX_SLACK_DAYS.year : APPROX_SLACK_DAYS.month;
      const ms = slack * MS_PER_DAY;
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

  function resolveInterval(startToken?: string, endToken?: string, opts?: ResolveOptions): ResolvedInterval {
    const rawStart = startToken ?? null;
    const rawEnd = endToken ?? null;
    let trimmed = false;
    let startClamped = false;

    let start = rawStart
      ? parseDateEdge(rawStart)
      : { earliest: DATASET_FLOOR, latest: DATASET_CUTOFF, precision: 'unknown' as Precision };

    let endEarliest: number | null;
    let endLatest: number | null;
    let endPrecision: Precision;
    let status: IntervalStatus;
    // The certainty horizon is finalized after the clamps below, because a
    // clamp can move a known end up to the start.
    let observed: number | null;

    const token = (rawEnd ?? '?').trim();

    if (token === 'ongoing') {
      endEarliest = null;
      endLatest = null;
      endPrecision = 'after';
      status = 'ongoing';
      observed = null;
    } else if (token.startsWith('verified:')) {
      const at = parseDateEdge(token.slice('verified:'.length));
      // Month-only observation: certainty at the month midpoint, not its last
      // day. A day-precision verification observes that day exactly.
      const instant = at.precision === 'month' ? Math.floor((at.earliest + at.latest) / 2) : at.latest;
      endEarliest = Math.min(at.latest, DATASET_CUTOFF);
      endLatest = DATASET_CUTOFF;
      endPrecision = at.precision;
      status = 'last-verified';
      observed = Math.min(instant, DATASET_CUTOFF);
    } else if (token === '?') {
      endEarliest = null;
      endLatest = DATASET_CUTOFF;
      endPrecision = 'unknown';
      status = 'unknown';
      observed = null;
    } else {
      const e = parseDateEdge(token);
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

    // An unknown end has exactly one observation: the latest instant the start
    // can fall on.
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
   * Confirmed: the observation is within ONGOING_CONFIRMATION_DAYS of the
   * cutoff, `ongoing` stands, and certainty runs through the observation.
   * Otherwise the status is downgraded to `last-verified`: certainty stops at
   * the observation (never before the start), and the envelope opens to the
   * cutoff. The build warns when this happens; it is never silent.
   */
  function applyOngoingObservation(iv: ResolvedInterval, lastObservation: number | null): ResolvedInterval {
    if (iv.status !== 'ongoing') return iv;
    const cutoff = DATASET_CUTOFF;
    const recent =
      lastObservation !== null &&
      lastObservation >= cutoff - ONGOING_CONFIRMATION_DAYS * MS_PER_DAY;
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
  function certainlyActive(iv: ResolvedInterval, t: number): boolean {
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
  function possiblyActive(iv: ResolvedInterval, t: number): boolean {
    if (t > DATASET_CUTOFF) return false;
    if (t < iv.startEarliest) return false;
    if (iv.endLatest !== null && t > iv.endLatest) return false;
    return true;
  }

  function durationYears(iv: ResolvedInterval): number {
    const startMid = (iv.startEarliest + iv.startLatest) / 2;
    const endMid =
      iv.endEarliest === null || iv.endLatest === null
        ? DATASET_CUTOFF
        : (iv.endEarliest + iv.endLatest) / 2;
    return Math.max(0, (endMid - startMid) / MS_PER_YEAR);
  }

  return Object.freeze({
    cutoff: DATASET_CUTOFF,
    floor: DATASET_FLOOR,
    beforeWindowYears: BEFORE_WINDOW_YEARS,
    approxSlackDays: Object.freeze({ ...APPROX_SLACK_DAYS }),
    parseDateEdge,
    resolveInterval,
    applyOngoingObservation,
    certainlyActive,
    possiblyActive,
    durationYears
  });
}
