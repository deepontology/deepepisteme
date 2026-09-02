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
import { resolveInterval, certainlyActive, possiblyActive } from './time.ts';
import { deriveBasis } from './claim.ts';

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
  const bw = resolveInterval({ start: '<=2020-06', end: '2020-06-15' });
  assert('<= clamps to window (before)', bw.startPrecision === 'before');
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
