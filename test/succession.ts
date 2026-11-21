/**
 * test/succession.ts: V24, the succession chain.
 *
 * Every expectation is computed by hand from the dates in the fixture, not by
 * running the same formula a second time: a handover of 731 days is 2.0 years
 * at 365.2425 days a year, a span of 548 days is 1.5. The ten-minute check a
 * reviewer can do with a calendar is the oracle; the code is the thing under
 * test.
 */

import { createEngine, type RawDataset } from '../src/engine.ts';
import { deriveSuccessions } from '../src/atlas/succession.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';

let failures = 0;
let passes = 0;

function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const engine = createEngine(ruritania);
const ONE = { gapYears: 1, overlapYears: 1 };

const sources = [{ id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2026-05-01', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }];
const role = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title_en: 'A fixture office',
  institution: 'ministry-infrastructure',
  authority: 50,
  summary: 'A synthetic office for the succession checks.',
  sources: ['s-journalism'],
  ...extra
});
const pos = (id: string, holder: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  role: 'role-ruria-office',
  holder,
  start,
  end,
  confidence: 'B',
  sources: ['s-journalism'],
  ...extra
});

function derive(positions: unknown[], roles: unknown[] = [role('role-ruria-office')], thresholds = ONE) {
  const raw = { source: sources, role: roles, position: positions } as RawDataset;
  const parsed = engine.parse(raw);
  const resolved = engine.resolve(parsed.records);
  return { resolved, result: engine.successions(resolved, thresholds), parsed };
}
const chain = (r: ReturnType<typeof derive>['result'], id: string) => `${r.neighbours.get(id)?.predecessor ?? '-'}>${r.neighbours.get(id)?.successor ?? '-'}`;

// A handover of 731 days: 2010-01-01 to 2012-01-01 then 2014-01-01 is 2.0 years.
{
  const { result, parsed } = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2014-01-01', '2016-01-01')]);
  assert('the fixture parses with no finding', parsed.findings.length === 0, JSON.stringify(parsed.findings));
  assert('two years between two holders is one gap', result.gaps.length === 1, JSON.stringify(result.gaps));
  assert(
    'the gap names the role, both holders and the length to a tenth of a year',
    JSON.stringify(result.gaps[0]) === JSON.stringify({ role: 'role-ruria-office', after: 'holder-a', before: 'holder-b', gapYears: 2 }),
    JSON.stringify(result.gaps[0])
  );
  assert('a handover with a gap is not an overlap', result.overlaps.length === 0);
}

// 2012-01-01 to 2013-07-02 is 366 + 182 = 548 days: 1.5 years, rounded to a tenth.
{
  const { result } = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2013-07-02', '2016-01-01')]);
  assert('548 days is a gap of 1.5 years', result.gaps.length === 1 && result.gaps[0].gapYears === 1.5, JSON.stringify(result.gaps));
}

// 2012-01-01 to 2012-06-01 is 152 days: 0.4 years, under the threshold.
{
  const { result } = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2012-06-01', '2016-01-01')]);
  assert('a handover under the threshold is not a gap', result.gaps.length === 0, JSON.stringify(result.gaps));
  assert('a handover on the same day is not a gap', derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2012-01-01', '2016-01-01')]).result.gaps.length === 0);
}

// The threshold is the caller's: the same two-year gap under a three-year threshold.
{
  const positions = [pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2014-01-01', '2016-01-01')];
  assert('a two-year gap is not a gap at a three-year threshold', derive(positions, undefined, { gapYears: 3, overlapYears: 1 }).result.gaps.length === 0);
  assert('a two-year gap is a gap at a zero threshold', derive(positions, undefined, { gapYears: 0, overlapYears: 1 }).result.gaps.length === 1);
}

// 2011-01-01 to 2013-01-01 is 731 days: two certain years of overlap.
{
  const { result } = derive([pos('p1', 'holder-a', '2010-01-01', '2013-01-01'), pos('p2', 'holder-b', '2011-01-01', '2014-01-01')]);
  assert('two holders who certainly sat together for two years are one overlap', result.overlaps.length === 1, JSON.stringify(result.overlaps));
  assert(
    'the overlap names the role, both holders and the length',
    JSON.stringify(result.overlaps[0]) === JSON.stringify({ role: 'role-ruria-office', a: 'holder-a', b: 'holder-b', overlapYears: 2 }),
    JSON.stringify(result.overlaps[0])
  );
  assert('an overlap is not a gap', result.gaps.length === 0);
  assert('half a year of overlap is under the threshold', derive([pos('p1', 'holder-a', '2010-01-01', '2013-01-01'), pos('p2', 'holder-b', '2012-07-01', '2014-01-01')]).result.overlaps.length === 0);
  assert(
    'the overlap threshold is the caller\'s',
    derive([pos('p1', 'holder-a', '2010-01-01', '2013-01-01'), pos('p2', 'holder-b', '2011-01-01', '2014-01-01')], undefined, { gapYears: 1, overlapYears: 3 }).result.overlaps.length === 0
  );
}

// An open interval does not manufacture an overlap: only an ended previous holder counts.
{
  const { result, resolved } = derive([pos('p1', 'holder-a', '2010-01-01', 'ongoing'), pos('p2', 'holder-b', '2011-01-01', '2014-01-01')]);
  assert('the open holder is not ended', resolved.intervals.get('position:p1')?.status !== 'ended');
  assert('a previous holder whose interval is open is not an overlap', result.overlaps.length === 0, JSON.stringify(result.overlaps));
}

// The chain: predecessor and successor by position id, in time order whatever the file order.
{
  const positions = [pos('p3', 'holder-c', '2016-01-01', '2018-01-01'), pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2012-01-01', '2016-01-01')];
  const { result } = derive(positions);
  assert('the first holder has no predecessor and the second as successor', chain(result, 'p1') === '->holder-b', chain(result, 'p1'));
  assert('the middle holder has both neighbours', chain(result, 'p2') === 'holder-a>holder-c', chain(result, 'p2'));
  assert('the last holder has no successor', chain(result, 'p3') === 'holder-b>-', chain(result, 'p3'));
  assert('every position of the role is in the chain', result.neighbours.size === 3);
}

// An authored predecessor wins over the derived one.
{
  const { result } = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2012-01-01', '2016-01-01', { predecessor: 'holder-z' })]);
  assert('an authored predecessor replaces the derived one', chain(result, 'p2') === 'holder-z>-', chain(result, 'p2'));
  assert('the authored predecessor does not change the other record', chain(result, 'p1') === '->holder-b', chain(result, 'p1'));
}

// Chains are per role.
{
  const roles = [role('role-ruria-office'), role('role-ruria-other')];
  const { result } = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2014-01-01', '2016-01-01', { role: 'role-ruria-other' })], roles);
  assert('two roles with one holder each make no gap', result.gaps.length === 0);
  assert('neither holder has a neighbour in the other role', chain(result, 'p1') === '->-' && chain(result, 'p2') === '->-', chain(result, 'p1'));
}

// A seated role has no chain: the same dates that are a gap and an overlap elsewhere yield nothing.
{
  const roles = [role('role-ruria-office', { seats: 5 })];
  const gapPair = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2014-01-01', '2016-01-01')], roles);
  assert('a seated role has no gap', gapPair.result.gaps.length === 0);
  assert('a seated role has no neighbours', gapPair.result.neighbours.size === 0);
  const overlapPair = derive([pos('p1', 'holder-a', '2010-01-01', '2013-01-01'), pos('p2', 'holder-b', '2011-01-01', '2014-01-01')], roles);
  assert('a seated role has no overlap', overlapPair.result.overlaps.length === 0);
}

// Bad thresholds are the caller's bug, not a finding.
{
  const { resolved } = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01')]);
  const throws = (t: unknown) => {
    try {
      engine.successions(resolved, t as typeof ONE);
      return false;
    } catch (e) {
      return /successions: (gapYears|overlapYears) must be a number of years/.test((e as Error).message);
    }
  };
  assert('a negative gap threshold is refused', throws({ gapYears: -1, overlapYears: 1 }));
  assert('a missing overlap threshold is refused', throws({ gapYears: 1 }));
  assert('a threshold that is not a number is refused', throws({ gapYears: '1', overlapYears: 1 }));
  assert('an infinite threshold is refused', throws({ gapYears: Infinity, overlapYears: 1 }));
}

// The function and the engine method are one derivation.
{
  const { resolved, result } = derive([pos('p1', 'holder-a', '2010-01-01', '2012-01-01'), pos('p2', 'holder-b', '2014-01-01', '2016-01-01')]);
  const direct = deriveSuccessions({ records: resolved.records, intervals: resolved.intervals, cutoff: engine.time.cutoff }, ONE);
  assert('the engine method is the derivation over the engine\'s own cutoff', JSON.stringify(direct.gaps) === JSON.stringify(result.gaps));
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
