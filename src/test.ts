/**
 * test.ts — minimal gate for the example jurisdiction.
 *
 * A reviewer clones the skeleton and runs:
 *   npm install && npm run data && npm run test
 *
 * All green means the engine compiles an evidence-graded corpus end-to-end.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdit } from './emit.ts';
import { buildMatcher } from './match.ts';
import { applyOngoingObservation, resolveInterval, certainlyActive, possiblyActive, getCutoff, getFloor } from './time.ts';
import { deriveBasis, configureClaimExceptions, PositionSchema, ReviewSchema } from './claim.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

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

console.log('\n  ── DeepEpisteme test gate ──\n');

// ---------------------------------------------------------------------------
// 1. Build artifact exists and is valid JSON
// ---------------------------------------------------------------------------

const datasetPath = join(ROOT, 'src', 'generated', 'dataset.json');
assert('dataset.json exists', existsSync(datasetPath));
let dataset: any = null;
if (existsSync(datasetPath)) {
  try {
    dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
    assert('dataset.json parses', true);
  } catch (e) {
    assert('dataset.json parses', false, String(e));
  }
}

// ---------------------------------------------------------------------------
// 2. Counts and jurisdiction
// ---------------------------------------------------------------------------

if (dataset) {
  assert('jurisdiction is Ruritania', dataset.meta?.jurisdiction === 'Ruritania', String(dataset.meta?.jurisdiction));
  assert('sources ≥ 3', (dataset.sources?.length ?? 0) >= 3, String(dataset.sources?.length));
  assert('institutions ≥ 3', (dataset.institutions?.length ?? 0) >= 3, String(dataset.institutions?.length));
  assert('people ≥ 3', (dataset.people?.length ?? 0) >= 3, String(dataset.people?.length));
  assert('positions ≥ 3', (dataset.positions?.length ?? 0) >= 3, String(dataset.positions?.length));
  assert('relationships ≥ 1', (dataset.relationships?.length ?? 0) >= 1, String(dataset.relationships?.length));
  assert('events ≥ 1', (dataset.events?.length ?? 0) >= 1, String(dataset.events?.length));
  assert('meta.parameters present', !!dataset.meta?.parameters);
  assert('meta.parameters.jurisdiction present', !!dataset.meta?.parameters?.jurisdiction);
  assert('all positions have basis', (dataset.positions ?? []).every((p: any) => !!p.basis));
  assert('all relationships have basis', (dataset.relationships ?? []).every((r: any) => !!r.basis));
  assert('all positions have interval', (dataset.positions ?? []).every((p: any) => !!p.interval));
}

// ---------------------------------------------------------------------------
// 3. Claim envelope — deriveBasis
// ---------------------------------------------------------------------------

assert('A → documented', deriveBasis('A', 'verified') === 'documented');
assert('D → unsubstantiated', deriveBasis('D', 'verified') === 'unsubstantiated');
assert('C + needs-primary-source → inferred', deriveBasis('C', 'needs-primary-source') === 'inferred');
assert('C + verified → reported', deriveBasis('C', 'verified') === 'reported');
assert('B → reported', deriveBasis('B', 'verified') === 'reported');
assert('explicit basis overrides', deriveBasis('A', 'verified', 'reported') === 'reported');

// ---------------------------------------------------------------------------
// 3b. Claim envelope — whitespace, override provenance, strict review
// ---------------------------------------------------------------------------

{
  const base = {
    id: 'p-fixture',
    role: 'r-fixture',
    holder: 'h-fixture',
    start: '2020-01-01',
    confidence: 'C',
    verification: 'needs-primary-source',
    sources: ['s-fixture']
  };
  assert(
    'whitespace attribution is rejected',
    !PositionSchema.safeParse({ ...base, attributed_to: ' ', reasoning: 'Reasoned.', falsifiable_by: 'A falsifier.' }).success
  );
  assert(
    'whitespace reasoning is rejected',
    !PositionSchema.safeParse({ ...base, attributed_to: 'Some Observer', reasoning: ' ', falsifiable_by: 'A falsifier.' }).success
  );
  const override = {
    ...base,
    attributed_to: 'Some Observer',
    reasoning: 'Reasoned.',
    falsifiable_by: 'A falsifier.',
    basis: 'documented'
  };
  assert('override without review is rejected', !PositionSchema.safeParse(override).success);
  assert(
    'unknown review key is rejected',
    !ReviewSchema.safeParse({ by: 'x', date: '2026-01-01', method: 'source-check', outcome: 'refuted' }).success
  );
  configureClaimExceptions({ basisOverrides: new Set(['position:p-fixture:inferred>documented']) });
  assert('registered override parses while its entry is live', PositionSchema.safeParse(override).success);
  configureClaimExceptions({});
  assert('de-registered override fails again', !PositionSchema.safeParse(override).success);
}

// ---------------------------------------------------------------------------
// 4. Time — interval resolver and predicates
// ---------------------------------------------------------------------------

{
  const iv = resolveInterval({ start: '2020-01-01', end: '2020-12-31' });
  assert('exact interval core contains mid-year', certainlyActive(iv, Date.UTC(2020, 5, 15)));
  assert('exact interval envelope contains mid-year', possiblyActive(iv, Date.UTC(2020, 5, 15)));
  assert('before start is neither active', !certainlyActive(iv, Date.UTC(2019, 0, 1)) && !possiblyActive(iv, Date.UTC(2019, 0, 1)));
  const approx = resolveInterval({ start: '~2020', end: '2021-01-01' });
  assert('approx interval resolves', approx.startPrecision === 'approx');
  const ongoing = resolveInterval({ start: '2022-01-01', end: 'ongoing' });
  assert('ongoing has null end', ongoing.endEarliest === null && ongoing.endLatest === null);
  const verified = resolveInterval({ start: '2020-01-01', end: 'verified:2024-06' });
  assert('verified interval last-verified', verified.status === 'last-verified');
  assert('verified day observation is the certainty horizon', verified.lastObserved !== null);
  const bw = resolveInterval({ start: '<=2020-06', end: '2020-06-15' });
  assert('<= clamps to window (before)', bw.startPrecision === 'before');

  // The review's probe: an unknown end never yields certainty past its one
  // observation (the start), and never yields certain without possible.
  const unknown = resolveInterval({ start: '2020-01-01', end: '?' });
  const pastCutoff = getCutoff() + 86_400_000;
  assert('unknown end: not certain at cutoff plus one day', !certainlyActive(unknown, pastCutoff));
  assert('unknown end: not certain without possible', !certainlyActive(unknown, pastCutoff) || possiblyActive(unknown, pastCutoff));

  // Month-only observation: certainty at the midpoint, possibility through the
  // month end (and no further than the cutoff).
  const monthVerified = resolveInterval({ start: '2019-01-01', end: 'verified:2020-06' });
  const monthMid = Math.floor((Date.UTC(2020, 5, 1) + Date.UTC(2020, 5, 30, 23, 59, 59)) / 2);
  assert('month observation is certain at the midpoint', certainlyActive(monthVerified, monthMid));
  assert('month observation is not certain on the last day', !certainlyActive(monthVerified, Date.UTC(2020, 5, 30, 23, 59, 59)));

  // Ongoing confirmation: a recent observation keeps the status; an old one
  // downgrades it and stops certainty at the observation.
  const confirmed = applyOngoingObservation(resolveInterval({ start: '2022-01-01', end: 'ongoing' }), getCutoff() - 10 * 86_400_000);
  assert('ongoing with a recent observation stays ongoing', confirmed.status === 'ongoing');
  assert('ongoing certainty stops at the observation', !certainlyActive(confirmed, getCutoff()));
  const stale = applyOngoingObservation(resolveInterval({ start: '2022-01-01', end: 'ongoing' }), Date.UTC(2024, 0, 1));
  assert('ongoing with a stale observation downgrades to last-verified', stale.status === 'last-verified');
  assert('downgraded certainty stops at the stale observation', certainlyActive(stale, Date.UTC(2024, 0, 1)) && !certainlyActive(stale, Date.UTC(2025, 0, 1)));

  // Generated property sweep: token combinations x boundary dates. The
  // invariant and the envelope rules must hold for every case.
  const starts = ['2018-06-01', '2018-06', '2018', '~2017', '~2017-06', '<=2018-06', '>=1984', '?'];
  const ends = ['2020-06-01', '2020-06', '2020', '~2020', 'ongoing', 'verified:2020-06', 'verified:2020-06-15', '?'];
  const boundary = (t: number) => [
    t - 86_400_000,
    t,
    t + 86_400_000
  ];
  const queries = new Set<number>([
    ...boundary(getFloor()),
    ...boundary(getCutoff()),
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
      iv = resolveInterval({ start: s, end: e });
    } catch {
      continue;
    }
    check(iv.startEarliest <= iv.startLatest, `ordering ${s}/${e}`);
    check(iv.endEarliest === null || iv.endLatest === null || iv.endEarliest <= iv.endLatest, `end ordering ${s}/${e}`);
    for (const t of queries) {
      check(!certainlyActive(iv, t) || possiblyActive(iv, t), `certain without possible ${s}/${e} @ ${new Date(t).toISOString()}`);
      check(!certainlyActive(iv, getCutoff() + 1) && !possiblyActive(iv, getCutoff() + 1), `assertion past cutoff ${s}/${e}`);
    }
  }
  assert('generated sweep: envelope ordering holds', sweepFailures.length === 0, sweepFailures[0] ?? '');
  assert('generated sweep: certain implies possible and nothing past cutoff', sweepFailures.length === 0, sweepFailures[0] ?? '');
}

// ---------------------------------------------------------------------------
// 5. Emit — single-region splicer
// ---------------------------------------------------------------------------

{
  const yaml = '- id: src-1\n  title: Original\n  publisher: Gaz\n  tier: 1\n  url: https://example.com\n';
  const edited = applyEdit(yaml, { op: 'set', target: { id: 'src-1' }, field: 'title', value: 'Revised' });
  assert('emit set edits only target', edited.text.includes('Revised') && !edited.text.includes('Original'));
  // Guard: editing unrelated record fails
  let guardFired = false;
  try {
    const source = '- id: a\n  title: A\n- id: b\n  title: B\n';
    // Try to assert no change would be wrong — test the guard directly
    const { assertOnlyTargetChanged } = await import('./emit.ts');
    assertOnlyTargetChanged(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      [{ id: 'a', title: 'X' }, { id: 'b', title: 'B' }],
      'b' // claim only b changed but a did — must throw
    );
  } catch (e) {
    guardFired = true;
  }
  assert('emit guard catches off-target mutation', guardFired);
}

// ---------------------------------------------------------------------------
// 6. Match — deterministic entity linking
// ---------------------------------------------------------------------------

{
  const matcher = buildMatcher([
    { id: 'alice-mir', kind: 'person', names: ['Alice Mir', 'Mir'] },
    { id: 'ruritanian-ministry', kind: 'institution', names: ['Ministry of Infrastructure'] }
  ]);
  const hits = matcher.find('Alice Mir met the Ministry of Infrastructure delegation.');
  assert('match finds person by full name', hits.some((h) => h.id === 'alice-mir'));
  assert('match finds institution by full name', hits.some((h) => h.id === 'ruritanian-ministry'));
  const noDup = buildMatcher([
    { id: 'a', kind: 'person', names: ['Jean Dupont'] },
    { id: 'b', kind: 'person', names: ['Jean Dupont'] }
  ]);
  // Ambiguous form is dropped — precision over recall
  assert('ambiguous form dropped', noDup.find('Jean Dupont').length === 0);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
console.log('  ✓ DeepEpisteme gate green — example jurisdiction compiles.\n');
