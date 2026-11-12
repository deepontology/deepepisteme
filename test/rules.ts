/**
 * test/rules.ts: the three kernel rules, each with the fixture that breaks it.
 *
 * A rule is a value: an id, a layer, a stage, and a function from the parsed
 * records to findings. Nothing here runs through validate(); slice 4 builds the
 * runner, so these are the register and its proof points.
 *
 * The fixtures are ported from deeptunisia's validator suite and its build-time
 * source checks, with synthetic Ruritanian names.
 */

import { z } from 'zod';
import { createEngine, type Deployment } from '../src/engine.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';
import { NO_EXCEPTIONS, convertRegister, type ExceptionRegister } from '../src/kernel/exceptions.ts';
import { V12, V25, V27, type RuleContext } from '../src/kernel/rules.ts';

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

/** A context the way slice 4 will build it: parsed records, the converted register, the claim kinds. */
function context(records: Record<string, unknown[]>, extra: ExceptionRegister | undefined = undefined): RuleContext {
  return {
    records: records as RuleContext['records'],
    exceptions: convertRegister(extra, engine.time.cutoff),
    claimKinds: new Set(['position'])
  };
}

const sources = [
  { id: 's-primary', tier: 1 },
  { id: 's-institutional', tier: 2 },
  { id: 's-journalism', tier: 3 },
  { id: 's-regional', tier: 4 }
];

// ---------------------------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------------------------

assert('engine.rules carries the three kernel rules', engine.rules.map((r) => r.id).join(',') === 'V12,V25,V27');
assert(
  'every rule declares its layer, severity and stage',
  engine.rules.every((r) => r.layer === 'kernel' && r.severity === 'error' && r.needs === 'parsed')
);
assert(
  'a deployment rule joins the register after the kernel rules',
  (() => {
    const extra = { ...engine.rules[0], id: 'V90' };
    const withExtra: Deployment = { ...ruritania, extraRules: [extra] };
    return createEngine(withExtra).rules.map((r) => r.id).join(',') === 'V12,V25,V27,V90';
  })()
);

// ---------------------------------------------------------------------------------------------
// V12: missing citations
// ---------------------------------------------------------------------------------------------

// deeptunisia: `rejects(PositionSchema, pos({ sources: [] }), 'a position with zero sources')`
// and the build loop over claimKindRegistry.
{
  const clean = { id: 'pos-cited', sources: ['s-primary'] };
  assert('V12: a cited record passes', V12.run(context({ position: [clean] })).length === 0);

  const missing = V12.run(context({ position: [{ id: 'pos-uncited', sources: [] }] }));
  assert('V12: an uncited record fails once', missing.length === 1, JSON.stringify(missing));
  assert('V12: the finding names the record', missing[0].record?.kind === 'position' && missing[0].record?.id === 'pos-uncited');
  assert('V12: the finding is an error', missing[0].severity === 'error');

  assert(
    'V12: a kind outside the required list is not checked',
    V12.run(context({ question: [{ id: 'q-1' }] })).length === 0
  );

  assert(
    'V12: an absent sources field counts as no source',
    V12.run(context({ position: [{ id: 'pos-null' }] })).length === 1
  );
}

{
  // The escape register, as deeptunisia's source-exceptions.yaml carries it.
  const register: ExceptionRegister = {
    sourceExceptions: new Map([
      ['position:pos-excepted', { rule: 'no-source', expires: '2026-12-01', reason: 'source in progress' }]
    ]),
    basisOverrides: new Map()
  };
  const ctx = context({ position: [{ id: 'pos-excepted', sources: [] }] }, register);
  assert('V12: a live exception silences its record', V12.run(ctx).length === 0);

  const expired: ExceptionRegister = {
    sourceExceptions: new Map([
      ['position:pos-excepted', { rule: 'no-source', expires: '2026-01-01', reason: 'source in progress' }]
    ]),
    basisOverrides: new Map()
  };
  assert(
    'V12: an expired exception silences nothing',
    V12.run(context({ position: [{ id: 'pos-excepted', sources: [] }] }, expired)).length === 1
  );
}

// ---------------------------------------------------------------------------------------------
// V25: grade A means a primary record
// ---------------------------------------------------------------------------------------------

// deeptunisia: the grade-A loop in scripts/build-data.ts, and its live
// grade-a-primary escapes.
{
  const base = { id: 'pos-grade-a', confidence: 'A', sources: ['s-journalism'] };

  const onlyTier3 = V25.run(context({ source: sources, position: [base] }));
  assert('V25: a grade-A record citing only tier-3 fails', onlyTier3.length === 1, JSON.stringify(onlyTier3));
  assert('V25: the finding names the record', onlyTier3[0].record?.id === 'pos-grade-a');
  assert('V25: the finding says what was cited', onlyTier3[0].message.includes('tier 3'));

  assert(
    'V25: a tier-1 source passes',
    V25.run(context({ source: sources, position: [{ ...base, sources: ['s-primary'] }] })).length === 0
  );
  assert(
    'V25: a tier-2 source passes',
    V25.run(context({ source: sources, position: [{ ...base, sources: ['s-institutional'] }] })).length === 0
  );
  assert(
    'V25: one good source among bad ones passes',
    V25.run(context({ source: sources, position: [{ ...base, sources: ['s-regional', 's-primary'] }] })).length === 0
  );
  assert(
    'V25: an unresolvable source id fails',
    V25.run(context({ source: sources, position: [{ ...base, sources: ['s-unknown'] }] })).length === 1
  );
  assert(
    'V25: a grade-B record is not checked',
    V25.run(context({ source: sources, position: [{ ...base, confidence: 'B' }] })).length === 0
  );
  assert(
    'V25: the source register itself is not checked',
    V25.run(context({ source: [{ id: 's-odd', confidence: 'A' }] })).length === 0
  );
}

{
  const register: ExceptionRegister = {
    sourceExceptions: new Map([
      ['position:pos-grade-a', { rule: 'grade-a-primary', expires: '2026-12-01', reason: 'primary source requested' }]
    ]),
    basisOverrides: new Map()
  };
  const excepted = { id: 'pos-grade-a', confidence: 'A', sources: ['s-journalism'] };
  assert(
    'V25: a live exception silences the grade-A failure',
    V25.run(context({ source: sources, position: [excepted] }, register)).length === 0
  );

  const reported = { ...excepted, basis: 'reported' };
  const warned = V25.run(context({ source: sources, position: [reported] }, register));
  assert('V25: an excepted grade-A record of a reported kind warns', warned.length === 1 && warned[0].severity === 'warning');
  assert('V25: the warning names V26 in its sentence', warned[0].message.includes('V26'));

  const expired: ExceptionRegister = {
    sourceExceptions: new Map([
      ['position:pos-grade-a', { rule: 'grade-a-primary', expires: '2026-01-01', reason: 'primary source requested' }]
    ]),
    basisOverrides: new Map()
  };
  assert(
    'V25: an expired exception fails again',
    V25.run(context({ source: sources, position: [excepted] }, expired)).length === 1
  );
}

// ---------------------------------------------------------------------------------------------
// V27: basis-override provenance
// ---------------------------------------------------------------------------------------------

// deeptunisia's test-validators V27 block, one missing part at a time.
{
  const full = {
    id: 'pos-override',
    sources: ['s-primary'],
    confidence: 'C' as const,
    verification: 'needs-primary-source' as const,
    basis: 'documented' as const,
    attributed_to: 'An observer',
    reasoning: 'Reasoned from the decree structure.',
    falsifiable_by: 'A later decree reversing the structure.',
    basis_override_reason: 'The primary decree is the claim; the grade reflects the missing literature.',
    review: { by: 'maintainer', date: '2026-09-10' }
  };

  assert('V27: a full override passes', V27.run(context({ position: [full] })).length === 0);
  assert('V27: no authored basis is not an override', V27.run(context({ position: [{ id: 'pos-plain', confidence: 'B' }] })).length === 0);
  assert(
    'V27: an authored basis equal to the implied one is not an override',
    V27.run(context({ position: [{ id: 'pos-equal', confidence: 'B', basis: 'reported' }] })).length === 0
  );

  const noReview = V27.run(context({ position: [{ ...full, review: undefined }] }));
  assert('V27: a missing review is found', noReview.some((f) => f.message.includes('review object')), JSON.stringify(noReview));

  const noReasoning = V27.run(context({ position: [{ ...full, reasoning: undefined }] }));
  assert('V27: missing reasoning is found', noReasoning.some((f) => f.message.includes('non-blank reasoning')));

  const noFalsifier = V27.run(context({ position: [{ ...full, falsifiable_by: undefined }] }));
  assert('V27: a missing falsifier is found on an inference', noFalsifier.some((f) => f.message.includes('falsifiable_by')));

  const noSource = V27.run(context({ position: [{ ...full, sources: [] }] }));
  assert('V27: a missing source is found', noSource.some((f) => f.message.includes('at least one source')));

  const noReason = V27.run(context({ position: [{ ...full, basis_override_reason: 'too short' }] }));
  assert('V27: a short override reason is found', noReason.some((f) => f.message.includes('basis_override_reason')));

  const all = V27.run(context({ position: [{ id: 'pos-bare', confidence: 'B', basis: 'documented' }] }));
  assert('V27: a bare override reports every missing part, each its own finding', all.length === 4, JSON.stringify(all));
  assert('V27: every finding carries the pair it is about', all.every((f) => f.message.startsWith('authored basis "documented" over grade-implied "reported"')));
}

{
  const register: ExceptionRegister = {
    sourceExceptions: new Map(),
    basisOverrides: new Map([
      ['position:pos-legacy:inferred>documented', { reason: 'pre-dates the rule', source: 'gazette-1' }]
    ])
  };
  const legacy = { id: 'pos-legacy', confidence: 'C', verification: 'needs-primary-source', basis: 'documented' };
  assert('V27: a registered override passes', V27.run(context({ position: [legacy] }, register)).length === 0);
  assert('V27: without the register the same record fails', V27.run(context({ position: [legacy] })).length > 0);

  const expired: ExceptionRegister = {
    sourceExceptions: new Map(),
    basisOverrides: new Map([
      ['position:pos-legacy:inferred>documented', { reason: 'pre-dates the rule', source: 'gazette-1', expires: '2026-01-01' }]
    ])
  };
  assert('V27: an expired override exception fails again', V27.run(context({ position: [legacy] }, expired)).length > 0);
}

{
  // A question carries an answer's claim fields but is not a claim kind, so the
  // envelope and V27 leave it alone, exactly as deeptunisia's registry does.
  const question = { id: 'q-1', confidence: 'B', basis: 'documented' };
  const ctx: RuleContext = { ...context({ question: [question] }), claimKinds: new Set<string>() };
  assert('V27: a kind without the envelope is not checked', V27.run(ctx).length === 0);
}

// ---------------------------------------------------------------------------------------------
// The schema-level checks and the rules agree
// ---------------------------------------------------------------------------------------------

{
  const engineWithPosition = createEngine({
    ...ruritania,
    extraKinds: [
      {
        kind: 'position',
        file: 'positions.yaml',
        bearsClaims: true,
        layer: 'deployment',
        schema: z.strictObject({
          id: z.string(),
          sources: z.array(z.string()).default([]),
          confidence: z.enum(['A', 'B', 'C', 'D']).default('B')
        })
      }
    ]
  });
  const record = { id: 'pos-agree', sources: ['s-journalism'], confidence: 'A' as const };
  const parsed = engineWithPosition.parse({ position: [record] });
  assert('parse accepts a record the envelope does not reject', parsed.findings.length === 0);
  const findings = V25.run(context({ source: sources, position: [record] }));
  assert('the rule still reports what the schema cannot see (source tiers)', findings.length === 1);
}

assert('NO_EXCEPTIONS is empty', NO_EXCEPTIONS.expired.length === 0 && NO_EXCEPTIONS.emptySources.size === 0);

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
