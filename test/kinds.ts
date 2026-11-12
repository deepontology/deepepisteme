/**
 * test/kinds.ts: the four kernel record kinds and the parse stage.
 *
 * parse() is the only place a record is typed. Every schema-level problem comes
 * back as a finding with the paper's rule id, so the build can count and name
 * it. The exception register is read once per call: a live entry lets its
 * record through, an expired one does not and is reported instead.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { createEngine, type Deployment } from '../src/engine.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';

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
    console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

function readList(path: string): unknown[] {
  const raw = parseYaml(readFileSync(join(ROOT, path), 'utf8'));
  return Array.isArray(raw) ? raw : [];
}

const engine = createEngine(ruritania);

// ---------------------------------------------------------------------------------------------
// The register of kinds
// ---------------------------------------------------------------------------------------------

assert('kinds holds the four kernel kinds', engine.kinds.size === 4, [...engine.kinds.keys()].join(','));
assert(
  'the kinds are named in parse order',
  [...engine.kinds.keys()].join(',') === 'source,question,hypothesis,verification'
);
assert(
  'every registered kind is a kernel kind with a file',
  [...engine.kinds.values()].every((d) => d.layer === 'kernel' && d.file.endsWith('.yaml'))
);
assert(
  'no kernel kind bears claims in this slice',
  [...engine.kinds.values()].every((d) => d.bearsClaims === false)
);
assert(
  'the verification enum takes the release form, with the new default first',
  [...engine.envelope.Verification.options].join(',') === 'unflagged,verified,needs-primary-source,disputed',
  [...engine.envelope.Verification.options].join(',')
);

// ---------------------------------------------------------------------------------------------
// The example data is clean
// ---------------------------------------------------------------------------------------------

{
  const example = {
    source: readList('data/sources.yaml'),
    question: readList('examples/ruritania/data/questions.yaml'),
    hypothesis: readList('examples/ruritania/data/hypotheses.yaml'),
    verification: readList('examples/ruritania/data/verifications.yaml')
  };
  const { records, findings } = engine.parse(example);
  assert(
    'the Ruritania example parses with no finding',
    findings.length === 0,
    findings.map((f) => `${f.rule} ${f.message}`).join(' | ')
  );
  assert(
    'every example record is kept',
    records.source.length === example.source.length &&
      records.question.length === example.question.length &&
      records.hypothesis.length === example.hypothesis.length &&
      records.verification.length === example.verification.length
  );
  assert(
    'a parsed record carries the schema defaults',
    records.source[0].id === 'gazette-2022-decree-44' &&
      (records.source[0] as unknown as { lang: string }).lang === 'en'
  );
  assert(
    'a verification defaults to blinded with no cited sources',
    (() => {
      const v = records.verification[0] as unknown as { blinded: boolean; sources: string[] };
      return v.blinded === true && Array.isArray(v.sources);
    })()
  );
  assert(
    'every registered kind is present even when the dataset is empty',
    engine.parse({}).records.source.length === 0 && Object.keys(engine.parse({}).records).length === 4
  );
}

// ---------------------------------------------------------------------------------------------
// The kinds' schemas, one at a time
// ---------------------------------------------------------------------------------------------

{
  const source = engine.kinds.get('source')!.schema;

  assert(
    'a source without a language takes the default',
    (source.parse({ id: 's-1', title: 'A title', publisher: 'A publisher', url: 'https://example.invalid/a', tier: 1 }) as { lang: string }).lang === 'en'
  );
  assert(
    'a language outside the deployment list is refused',
    !source.safeParse({ id: 's-1', title: 'A title', publisher: 'A publisher', url: 'https://example.invalid/a', tier: 1, lang: 'zz' }).success
  );
  assert(
    'a source URL that is not http(s) is refused',
    !source.safeParse({ id: 's-1', title: 'A title', publisher: 'A publisher', url: 'ftp://example.invalid/a', tier: 1 }).success
  );
  assert(
    'a year-only archive lookup is refused',
    !source.safeParse({
      id: 's-1',
      title: 'A title',
      publisher: 'A publisher',
      url: 'https://example.invalid/a',
      archive_url: 'https://web.archive.org/web/2026/https://example.invalid/a',
      tier: 1
    }).success
  );
  assert(
    'a timestamped archive capture is accepted',
    source.safeParse({
      id: 's-1',
      title: 'A title',
      publisher: 'A publisher',
      url: 'https://example.invalid/a',
      archive_url: 'https://web.archive.org/web/20260101000000/https://example.invalid/a',
      tier: 1
    }).success
  );
  assert(
    'a tier outside one to five is refused',
    !source.safeParse({ id: 's-1', title: 'A title', publisher: 'A publisher', url: 'https://example.invalid/a', tier: 6 }).success
  );
}

{
  const question = engine.kinds.get('question')!.schema;
  const base = { id: 'q-1', question: 'Why did the ministry move the file?', kind: 'analytical' };
  const parsed = question.parse(base) as { status: string; relates_to: unknown[]; sources: unknown[] };
  assert(
    'a question defaults to open with no references and no sources',
    parsed.status === 'open' && parsed.relates_to.length === 0 && parsed.sources.length === 0
  );
  assert('a question under ten characters is refused', !question.safeParse({ ...base, question: 'Why?' }).success);
  assert('an unknown question kind is refused', !question.safeParse({ ...base, kind: 'editorial' }).success);
  assert(
    'a question carries translated prose per deployment locale',
    question.safeParse({ ...base, question_fr: 'Pourquoi ?', question_fr_by: 'machine' }).success &&
      !question.safeParse({ ...base, question_de: 'Warum?' }).success
  );
}

{
  const hypothesis = engine.kinds.get('hypothesis')!.schema;
  const base = {
    id: 'h-1',
    label: 'A causal claim',
    statement: 'The reshuffle followed the concession dispute.',
    support: 'moderate',
    reasoning: 'Both accounts place it in the same week.',
    falsifiable_by: 'A cabinet minute naming a different cause.'
  };
  const parsed = hypothesis.parse(base) as { evidence: unknown[]; sources: unknown[] };
  assert('a hypothesis defaults to no evidence and no sources', parsed.evidence.length === 0 && parsed.sources.length === 0);
  assert(
    'a hypothesis with a short falsifier is refused',
    !hypothesis.safeParse({ ...base, falsifiable_by: 'A minute.' }).success
  );
  assert(
    'a hypothesis needs a support verdict',
    !hypothesis.safeParse({ ...base, support: 'likely' }).success
  );
  assert(
    'an evidence finding with no source is refused',
    !hypothesis.safeParse({
      ...base,
      evidence: [{ finding: 'neutral', evidence: 'The account names the file but not the cause.' }]
    }).success
  );
  assert(
    'an evidence finding with a source and a full envelope parses',
    hypothesis.safeParse({
      ...base,
      evidence: [
        {
          finding: 'neutral',
          evidence: 'The account names the file but not the cause.',
          sources: ['s-1'],
          confidence: 'C',
          attributed_to: 'A newspaper'
        }
      ]
    }).success
  );
}

{
  const verification = engine.kinds.get('verification')!.schema;
  const base = {
    id: 'v-1',
    claim: 'position:pos-1',
    kind: 'position',
    basis: 'documented',
    date: '2026-04-18',
    by: 'second reader',
    method: 'Study rubric',
    outcome: 'supported'
  };
  const parsed = verification.parse(base) as { blinded: boolean; sources: unknown[] };
  assert('a verification defaults to blinded and uncited', parsed.blinded === true && parsed.sources.length === 0);
  assert('a verification date must be YYYY-MM-DD', !verification.safeParse({ ...base, date: '2026-4-18' }).success);
  assert('an outcome outside the five is refused', !verification.safeParse({ ...base, outcome: 'maybe' }).success);
  assert(
    'a verification is not a claim record and takes no envelope fields',
    !verification.safeParse({ ...base, confidence: 'A' }).success
  );
}

// ---------------------------------------------------------------------------------------------
// parse(): findings, one per schema-level rule
// ---------------------------------------------------------------------------------------------

const positionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids must be lowercase kebab-case'),
  sources: z.array(z.string()).default([]),
  confidence: z.enum(['A', 'B', 'C', 'D']).default('B'),
  verification: z.enum(['unflagged', 'verified', 'needs-primary-source', 'disputed']).default('unflagged'),
  basis: z.enum(['documented', 'reported', 'inferred', 'unsubstantiated']).optional(),
  attributed_to: z.string().optional(),
  reasoning: z.string().optional(),
  falsifiable_by: z.string().optional(),
  basis_override_reason: z.string().optional(),
  review: z.strictObject({ by: z.string(), date: z.string() }).optional()
});

const claimDeployment: Deployment = {
  ...ruritania,
  extraKinds: [
    { kind: 'position', file: 'positions.yaml', schema: positionSchema, bearsClaims: true, layer: 'deployment' }
  ]
};
const claims = createEngine(claimDeployment);

function only(findings: { rule: string; record?: { kind: string; id: string }; message: string }[]) {
  return findings.length === 1 ? findings[0] : undefined;
}

{
  const clean = { id: 'pos-1', sources: ['s-1'], confidence: 'B' as const };
  const result = claims.parse({ position: [clean] });
  assert('a clean claim record gives no finding', result.findings.length === 0);
  assert('a clean claim record is kept', result.records.position.length === 1);
}

{
  const result = claims.parse({ position: [{ id: 'pos-2' }] });
  const finding = only(result.findings);
  assert('V12: a claim record with no source gives exactly one finding', !!finding && finding.rule === 'V12', JSON.stringify(result.findings));
  assert('V12: the finding names the record', finding?.record?.kind === 'position' && finding?.record?.id === 'pos-2');
  assert('V12: the record is not kept', result.records.position.length === 0);
}

{
  const result = claims.parse({ position: [{ id: 'pos-3', sources: ['s-1'], confidence: 'C' }] });
  const finding = only(result.findings);
  assert('V20: a grade C claim with no attribution gives exactly one finding', !!finding && finding.rule === 'V20', JSON.stringify(result.findings));
  assert('V20: the finding names the record', finding?.record?.id === 'pos-3');
}

{
  const result = claims.parse({
    position: [{ id: 'pos-4', sources: ['s-1'], confidence: 'C', verification: 'needs-primary-source', attributed_to: 'An observer' }]
  });
  const finding = only(result.findings);
  assert('V18: an inferred claim with no reasoning gives exactly one finding', !!finding && finding.rule === 'V18', JSON.stringify(result.findings));
}

{
  const result = claims.parse({
    position: [
      {
        id: 'pos-5',
        sources: ['s-1'],
        confidence: 'C',
        verification: 'needs-primary-source',
        attributed_to: 'An observer',
        basis: 'documented',
        reasoning: 'Reasoned from the decree structure.',
        basis_override_reason: 'The primary decree is the claim; the grade reflects the missing literature.',
        review: { by: 'maintainer', date: '2026-09-10' }
      }
    ]
  });
  const finding = only(result.findings);
  assert(
    'V27: an inferred-target override with no falsifier gives exactly one finding',
    !!finding && finding.rule === 'V27' && finding.message.includes('falsifiable_by'),
    JSON.stringify(result.findings)
  );
}

{
  const result = engine.parse({
    source: [{ id: 's-bad', title: 'A title', publisher: 'A publisher', url: 'https://example.invalid/a', tier: 1, unknown_key: true }]
  });
  const finding = only(result.findings);
  assert('V19: an undeclared key gives exactly one finding', !!finding && finding.rule === 'V19', JSON.stringify(result.findings));
  assert('V19: the finding names the record and the field', finding?.record?.id === 's-bad' && finding.message.includes('unknown_key'));
}

{
  const result = engine.parse({ region: [{ id: 'r-1' }] });
  const finding = only(result.findings);
  assert('V19: an unregistered kind gives exactly one finding', !!finding && finding.rule === 'V19');
  assert('V19: the unregistered kind is not read', !('region' in result.records));
}

{
  const result = engine.parse({ source: { id: 's-1' } as unknown as unknown[] });
  const finding = only(result.findings);
  assert('V19: a kind that is not a list gives exactly one finding', !!finding && finding.rule === 'V19');
}

// ---------------------------------------------------------------------------------------------
// The exception register
// ---------------------------------------------------------------------------------------------

{
  const bad = { id: 'pos-6' };
  const good = { id: 'pos-7', sources: ['s-1'] };
  const live = {
    sourceExceptions: new Map([['position:pos-6', { rule: 'no-source', expires: '2026-12-01', reason: 'source in progress' }]]),
    basisOverrides: new Map()
  };
  const result = claims.parse({ position: [bad, good] }, live);
  assert('a live exception silences its record', result.findings.length === 0, JSON.stringify(result.findings));
  assert('the excepted record parses and is kept', result.records.position.length === 2);

  const only7 = claims.parse({ position: [good] }, live);
  assert('an exception changes nothing about other records', only7.findings.length === 0);

  const neighbour = claims.parse({ position: [{ id: 'pos-8' }] }, live);
  assert('the exception is keyed by record, not by kind', neighbour.findings.length === 1);

  const without = claims.parse({ position: [bad] }, undefined);
  assert('without the register the same record still fails', without.findings.length === 1);
}

{
  const expired = {
    sourceExceptions: new Map([['position:pos-9', { rule: 'no-source', expires: '2026-01-01', reason: 'was in progress' }]]),
    basisOverrides: new Map()
  };
  const result = claims.parse({ position: [{ id: 'pos-9' }] }, expired);
  assert('an expired exception silences nothing', result.records.position.length === 0);
  assert(
    'an expired exception is reported',
    result.findings.some((f) => f.message.includes('no longer counts') && f.rule === 'V12'),
    JSON.stringify(result.findings)
  );
  assert('the expired record is reported too', result.findings.some((f) => f.record?.id === 'pos-9' && f.rule === 'V12'));
}

{
  const register = {
    sourceExceptions: new Map(),
    basisOverrides: new Map([
      [
        'position:pos-10:reported>documented',
        { reason: 'the decree is primary', source: 'gazette-1' }
      ]
    ])
  };
  const override = { id: 'pos-10', sources: ['s-1'], confidence: 'B', basis: 'documented' };
  const silenced = claims.parse({ position: [override] }, register);
  assert('a registered basis override is silenced', silenced.findings.length === 0, JSON.stringify(silenced.findings));
  assert('the override parse keeps the record', silenced.records.position.length === 1);

  const typedWrong = claims.parse(
    { position: [{ ...override, id: 'pos-11' }] },
    {
      sourceExceptions: new Map(),
      basisOverrides: new Map([['position:pos-11:reported>documented', { reason: 'r', source: 's' }]])
    }
  );
  assert('the override key is the kind, the id and the pair', typedWrong.findings.length === 0);

  const wrongPair = claims.parse(
    { position: [{ ...override, id: 'pos-12' }] },
    {
      sourceExceptions: new Map(),
      basisOverrides: new Map([['position:pos-12:inferred>documented', { reason: 'r', source: 's' }]])
    }
  );
  assert('a key for a different pair does not silence', wrongPair.findings.length > 0);
}

{
  // One engine's register is not another's: parse holds no state between calls.
  const withEscape = {
    sourceExceptions: new Map([['position:pos-13', { rule: 'no-source', expires: '2026-12-01', reason: 'open' }]]),
    basisOverrides: new Map()
  };
  const other = createEngine(claimDeployment);
  assert('the first engine honours its register', claims.parse({ position: [{ id: 'pos-13' }] }, withEscape).findings.length === 0);
  assert('a second engine sees no register', other.parse({ position: [{ id: 'pos-13' }] }).findings.length === 1);
  assert('the first engine does not remember the register', claims.parse({ position: [{ id: 'pos-13' }] }).findings.length === 1);
}

// ---------------------------------------------------------------------------------------------
// A deployment's literals reach its schemas
// ---------------------------------------------------------------------------------------------

{
  const german: Deployment = { ...ruritania, translatedLocales: ['de'] };
  const de = createEngine(german).kinds.get('question')!.schema;
  const base = { id: 'q-9', question: 'Why did the ministry move the file?', kind: 'analytical' };
  assert('a deployment adds a translated locale to its schemas', de.safeParse({ ...base, question_de: 'Warum?' }).success);
  assert('a locale the deployment does not list is refused', !de.safeParse({ ...base, question_fr: 'Pourquoi ?' }).success);

  const sourceWithRussian = createEngine({ ...ruritania, sourceLanguages: ['ar', 'fr', 'en', 'it', 'de', 'ru'] })
    .kinds.get('source')!.schema;
  const record = { id: 's-9', title: 'A title', publisher: 'A publisher', url: 'https://example.invalid/a', tier: 1, lang: 'ru' };
  assert('a deployment adds a source language', sourceWithRussian.safeParse(record).success);
  assert('a deployment without it refuses the same record', !engine.kinds.get('source')!.schema.safeParse(record).success);
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
