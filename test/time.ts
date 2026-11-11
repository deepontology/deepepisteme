/**
 * test/time.ts — the interval resolver on a createTime() object.
 *
 * Ported from the v0.1 gate (src/test.ts section 4), unchanged in intent:
 * the same intervals, the same invariants, the same generated sweep. The only
 * difference is that configuration arrives as an argument instead of through
 * module state.
 */

import { createTime, ONGOING_CONFIRMATION_DAYS } from '../src/kernel/time.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';

let failures = 0;
let passes = 0;

function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const time = createTime(ruritania.time);
const DAY = 86_400_000;

// Exact interval
{
  const iv = time.resolveInterval('2020-01-01', '2020-12-31');
  assert('exact interval core contains mid-year', time.certainlyActive(iv, Date.UTC(2020, 5, 15)));
  assert('exact interval envelope contains mid-year', time.possiblyActive(iv, Date.UTC(2020, 5, 15)));
  assert(
    'before start is neither active',
    !time.certainlyActive(iv, Date.UTC(2019, 0, 1)) && !time.possiblyActive(iv, Date.UTC(2019, 0, 1))
  );
}

// Approximate, ongoing, verified, window
{
  const approx = time.resolveInterval('~2020', '2021-01-01');
  assert('approx interval resolves', approx.startPrecision === 'approx');

  const ongoing = time.resolveInterval('2022-01-01', 'ongoing');
  assert('ongoing has null end', ongoing.endEarliest === null && ongoing.endLatest === null);

  const verified = time.resolveInterval('2020-01-01', 'verified:2024-06');
  assert('verified interval last-verified', verified.status === 'last-verified');
  assert('verified observation is the certainty horizon', verified.lastObserved !== null);

  const bw = time.resolveInterval('<=2020-06', '2020-06-15');
  assert('<= clamps to the before window', bw.startPrecision === 'before');
}

// An unknown end has one observation, the start, and never yields certainty
// without possibility.
{
  const unknown = time.resolveInterval('2020-01-01', '?');
  const pastCutoff = time.cutoff + DAY;
  assert('unknown end: not certain at cutoff plus one day', !time.certainlyActive(unknown, pastCutoff));
  assert(
    'unknown end: not certain without possible',
    !time.certainlyActive(unknown, pastCutoff) || time.possiblyActive(unknown, pastCutoff)
  );
  assert('unknown end is observed only through its start', unknown.lastObserved === unknown.startLatest);
}

// Month-only observation: certainty at the midpoint, possibility through the
// month end, and no further than the cutoff.
{
  const monthVerified = time.resolveInterval('2019-01-01', 'verified:2020-06');
  const monthMid = Math.floor((Date.UTC(2020, 5, 1) + Date.UTC(2020, 5, 30, 23, 59, 59)) / 2);
  assert('month observation is certain at the midpoint', time.certainlyActive(monthVerified, monthMid));
  assert(
    'month observation is not certain on the last day',
    !time.certainlyActive(monthVerified, Date.UTC(2020, 5, 30, 23, 59, 59))
  );
}

// Ongoing confirmation: a recent observation keeps the status; an old one
// downgrades it and stops certainty at the observation.
{
  const confirmed = time.applyOngoingObservation(
    time.resolveInterval('2022-01-01', 'ongoing'),
    time.cutoff - 10 * DAY
  );
  assert('ongoing with a recent observation stays ongoing', confirmed.status === 'ongoing');
  assert('ongoing certainty stops at the observation', !time.certainlyActive(confirmed, time.cutoff));

  const edge = time.applyOngoingObservation(
    time.resolveInterval('2022-01-01', 'ongoing'),
    time.cutoff - (ONGOING_CONFIRMATION_DAYS - 1) * DAY
  );
  assert('the confirmation window is inclusive', edge.status === 'ongoing');

  const stale = time.applyOngoingObservation(time.resolveInterval('2022-01-01', 'ongoing'), Date.UTC(2024, 0, 1));
  assert('ongoing with a stale observation downgrades to last-verified', stale.status === 'last-verified');
  assert(
    'downgraded certainty stops at the stale observation',
    time.certainlyActive(stale, Date.UTC(2024, 0, 1)) && !time.certainlyActive(stale, Date.UTC(2025, 0, 1))
  );
}

// The side argument is accepted and changes nothing.
{
  const bare = time.parseDateEdge('~2020');
  const asStart = time.parseDateEdge('~2020', 'start');
  const asEnd = time.parseDateEdge('~2020', 'end');
  assert(
    'a date edge is resolved the same for either side',
    bare.earliest === asStart.earliest && asStart.earliest === asEnd.earliest
  );
}

// Envelope trim is opt-in and reported.
{
  let threw = false;
  try {
    time.resolveInterval('2020-06-01', '2020-01-01');
  } catch {
    threw = true;
  }
  assert('an interval that ends before it begins throws', threw);
  const trimmed = time.resolveInterval('2020-06-01', '2020-01-01', { allowEnvelopeTrim: true });
  assert(
    'envelope trim keeps the authored edges instead of clamping',
    trimmed.startLatest === Date.UTC(2020, 5, 1) && trimmed.endLatest! < trimmed.startEarliest
  );
}

// Generated sweep: token combinations x boundary dates. The invariant and the
// envelope rules must hold for every case.
{
  const starts = ['2018-06-01', '2018-06', '2018', '~2017', '~2017-06', '<=2018-06', '>=1984', '?'];
  const ends = ['2020-06-01', '2020-06', '2020', '~2020', 'ongoing', 'verified:2020-06', 'verified:2020-06-15', '?'];
  const boundary = (t: number) => [t - DAY, t, t + DAY];
  const queries = new Set<number>([
    ...boundary(time.floor),
    ...boundary(time.cutoff),
    Date.UTC(2020, 1, 29),
    Date.UTC(2024, 1, 29),
    Date.UTC(2017, 0, 1),
    Date.UTC(2018, 5, 15),
    Date.UTC(2020, 5, 15),
    Date.UTC(2021, 5, 15)
  ]);
  let seed = 20260910;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pool = [...starts.flatMap((s) => ends.map((e) => [s, e] as const))];
  const sweepFailures: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond && sweepFailures.length < 5) sweepFailures.push(msg);
  };
  for (let i = 0; i < 1000; i++) {
    const [s, e] = pool[i < pool.length ? i : Math.floor(rand() * pool.length)];
    let iv;
    try {
      iv = time.resolveInterval(s, e);
    } catch {
      continue;
    }
    check(iv.startEarliest <= iv.startLatest, `ordering ${s}/${e}`);
    check(iv.endEarliest === null || iv.endLatest === null || iv.endEarliest <= iv.endLatest, `end ordering ${s}/${e}`);
    for (const t of queries) {
      check(
        !time.certainlyActive(iv, t) || time.possiblyActive(iv, t),
        `certain without possible ${s}/${e} @ ${new Date(t).toISOString()}`
      );
      check(
        !time.certainlyActive(iv, time.cutoff + 1) && !time.possiblyActive(iv, time.cutoff + 1),
        `assertion past cutoff ${s}/${e}`
      );
    }
  }
  assert('generated sweep: envelope ordering holds', sweepFailures.length === 0, sweepFailures[0] ?? '');
  assert(
    'generated sweep: certain implies possible and nothing past cutoff',
    sweepFailures.length === 0,
    sweepFailures[0] ?? ''
  );
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
