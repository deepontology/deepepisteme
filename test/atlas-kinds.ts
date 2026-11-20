/**
 * test/atlas-kinds.ts: the ported record kinds, one battery per kind.
 *
 * A kind is declared as its plain object schema; parse() applies the claim
 * envelope with that call's exception register. The battery per kind: one
 * valid record that parses and is kept with no finding, then one broken
 * record per refinement the kind's schema carries (its own and the envelope's
 * five), each asserted to name the rule id the finding carries.
 *
 * The example dataset in examples/ruritania/data/ is parsed as a whole at the
 * end: the records a fork copies must pass the same gate as these.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { createEngine, type RawDataset } from '../src/engine.ts';
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

const engine = createEngine(ruritania);

type Rec = Record<string, unknown>;

function parseOne(kind: string, record: Rec) {
  return engine.parse({ [kind]: [record] } as RawDataset);
}

/** The findings one record produced, register noise excluded. */
function recordFindings(kind: string, record: Rec) {
  const { findings } = parseOne(kind, record);
  return findings;
}

interface Broken {
  name: string;
  record: Rec;
  /** The rule id the finding must carry. */
  rule: string;
  /** A fragment the finding's message must contain, when one is worth pinning. */
  message?: string;
}

interface KindCase {
  kind: string;
  valid: Rec;
  /**
   * The rule an omitted citation produces: V12 where the kind defaults its
   * sources to an empty list, V19 where the field itself demands one.
   */
  sourcesRule?: 'V12' | 'V19';
  broken: Broken[];
}

/**
 * The envelope's five refinements, as broken records derived from any kind's
 * valid base. `sourcesRule` is V12 where the kind defaults its sources to an
 * empty list (dropping the key leaves the default), and V19 where the field
 * itself demands one (an empty list fails the field check, and a failed
 * field stops the envelope's checks).
 */
function envelopeBattery(kind: string, valid: Rec, sourcesRule: string): Broken[] {
  const drop = (key: string, into: Rec): Rec => {
    const { [key]: _gone, ...rest } = into;
    return rest;
  };
  return [
    {
      name: 'no source citation',
      record: sourcesRule === 'V12' ? drop('sources', valid) : { ...valid, sources: [] },
      rule: sourcesRule,
      message:
        sourcesRule === 'V12'
          ? 'must cite at least one source'
          : 'needs at least one source'
    },
    {
      name: 'grade C with no attribution',
      record: { ...drop('attributed_to', valid), confidence: 'C' },
      rule: 'V20'
    },
    {
      name: 'inferred with no reasoning',
      record: {
        ...drop('reasoning', drop('falsifiable_by', valid)),
        confidence: 'C',
        verification: 'needs-primary-source',
        attributed_to: 'An observer'
      },
      rule: 'V18'
    },
    {
      name: 'incompatible source relation',
      record: { ...valid, confidence: 'A', source_relation: 'direct-report', independence: 1 },
      rule: 'V26'
    },
    {
      name: 'basis override with no review',
      record: { ...drop('review', valid), confidence: 'B', basis: 'documented' },
      rule: 'V27'
    }
  ];
}

const cases: KindCase[] = [
  {
    kind: 'institution',
    sourcesRule: 'V12',
    valid: {
      id: 'inst-ministry-infra',
      name_en: 'Ministry of Infrastructure',
      type: 'ministry',
      layer: 'political',
      parent: null,
      active: { start: '1991-01-01' },
      order: 10,
      summary: 'Cabinet ministry for transport and public works.',
      sources: ['gazette-2022-decree-44']
    },
    broken: [
      { name: 'a type outside the deployment vocabulary', record: { id: 'i-1', name_en: 'A name', type: 'temple', layer: 'political', sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'an undeclared key', record: { id: 'i-2', name_en: 'A name', type: 'ministry', layer: 'political', sources: ['gazette-2022-decree-44'], ministry_of: 'transport' }, rule: 'V19' },
      { name: 'a malformed active interval', record: { id: 'i-3', name_en: 'A name', type: 'ministry', layer: 'political', sources: ['gazette-2022-decree-44'], active: { start: '1991-1' } }, rule: 'V19' }
    ]
  },
  {
    kind: 'role',
    valid: {
      id: 'role-infra-minister',
      title_en: 'Minister of Infrastructure',
      institution: 'inst-ministry-infra',
      authority: 82,
      summary: 'Cabinet minister for transport and public works.',
      sources: ['gazette-2022-decree-44']
    },
    broken: [
      { name: 'an authority outside zero to a hundred', record: { id: 'r-1', title_en: 'A role', institution: 'inst-ministry-infra', authority: 200, sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'an undeclared key', record: { id: 'r-2', title_en: 'A role', institution: 'inst-ministry-infra', authority: 50, salary: 'high', sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'a missing institution', record: { id: 'r-3', title_en: 'A role', authority: 50, sources: ['gazette-2022-decree-44'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'person',
    sourcesRule: 'V12',
    valid: {
      id: 'elena-varn',
      name_en: 'Elena Varn',
      layers: ['political'],
      tagline: 'Minister of Infrastructure (2022-2024)',
      summary: 'Career civil servant; appointed minister in 2022.',
      sources: ['gazette-2022-decree-44']
    },
    broken: [
      { name: 'no analytical layer', record: { id: 'p-1', name_en: 'A person', layers: [], sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'a malformed birth token', record: { id: 'p-2', name_en: 'A person', layers: ['political'], birth: 'June 1956', sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      {
        name: 'a whitespace-only attribution',
        record: { id: 'p-3', name_en: 'A person', layers: ['political'], confidence: 'C', attributed_to: '   ', sources: ['gazette-2022-decree-44'] },
        rule: 'V20'
      }
    ]
  },
  {
    kind: 'position',
    sourcesRule: 'V19',
    valid: {
      id: 'pos-varn-2022',
      role: 'role-infra-minister',
      holder: 'elena-varn',
      start: '2022-03-15',
      sources: ['gazette-2022-decree-44']
    },
    broken: [
      { name: 'an empty source list', record: { id: 'q-1', role: 'role-infra-minister', holder: 'elena-varn', sources: [] }, rule: 'V19', message: 'every position needs at least one source' },
      { name: 'a malformed start token', record: { id: 'q-2', role: 'role-infra-minister', holder: 'elena-varn', start: '2022-3-15', sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'an undeclared key', record: { id: 'q-3', role: 'role-infra-minister', holder: 'elena-varn', sources: ['gazette-2022-decree-44'], salary: 'high' }, rule: 'V19' }
    ]
  },
  {
    kind: 'relationship',
    sourcesRule: 'V12',
    valid: {
      id: 'rel-varn-appoints-tell',
      from: 'elena-varn',
      to: 'marco-tell',
      type: 'appointment',
      description: 'Varn appointed Tell deputy minister of infrastructure.',
      confidence: 'B',
      sources: ['herald-ruritania-2024-03-10']
    },
    broken: [
      {
        name: 'an allegation with no source',
        record: { id: 'rel-1', from: 'elena-varn', to: 'marco-tell', type: 'allegation', description: 'An accusation that circulates.', confidence: 'B', sources: [] },
        rule: 'V12',
        message: 'an allegation must carry a source showing the claim circulates'
      },
      {
        name: 'influence metadata off the influence family',
        record: { id: 'rel-2', from: 'elena-varn', to: 'marco-tell', type: 'family', description: 'A family tie with a stated channel.', confidence: 'B', sources: ['herald-ruritania-2024-03-10'], influence: { channel: 'marriage', strength: 0.8 } },
        rule: 'V19',
        message: 'influence metadata is allowed only on influence-family edges'
      },
      {
        name: 'influence strength with no reasoning',
        record: { id: 'rel-3', from: 'elena-varn', to: 'marco-tell', type: 'influence', description: 'A stated influence with a channel.', confidence: 'B', sources: ['herald-ruritania-2024-03-10'], influence: { channel: 'advice-relationship', strength: 0.9 } },
        rule: 'V19',
        message: 'must state its reasoning (V9)'
      },
      {
        name: 'finance metadata off the money edges',
        record: { id: 'rel-4', from: 'elena-varn', to: 'inst-ministry-infra', type: 'board', description: 'A board seat with money attached.', confidence: 'B', sources: ['herald-ruritania-2024-03-10'], finance: { amount: 10, currency: 'EUR', year: 2024 } },
        rule: 'V19',
        message: 'finance metadata is allowed only on funding, sponsorship and ownership edges (V13)'
      }
    ]
  },
  {
    kind: 'event',
    sourcesRule: 'V19',
    valid: {
      id: 'ev-reshuffle-2024',
      date: '2024-03-10',
      title_en: 'Cabinet reshuffle',
      category: 'political',
      summary: 'The reshuffle moved the infrastructure portfolio.',
      actors: ['elena-varn'],
      sources: ['herald-ruritania-2024-03-10']
    },
    broken: [
      { name: 'an empty source list', record: { id: 'e-1', date: '2024-03-10', title_en: 'A title', category: 'political', summary: 'A long enough summary.', sources: [] }, rule: 'V19', message: 'every event needs at least one source' },
      { name: 'a category outside the taxonomy', record: { id: 'e-2', date: '2024-03-10', title_en: 'A title', category: 'cultural', summary: 'A long enough summary.', sources: ['herald-ruritania-2024-03-10'] }, rule: 'V19' },
      { name: 'a malformed date token', record: { id: 'e-3', date: 'Easter 2024', title_en: 'A title', category: 'political', summary: 'A long enough summary.', sources: ['herald-ruritania-2024-03-10'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'era',
    valid: {
      id: 'era-reform-1991-2004',
      label_en: 'Reform Era',
      start: '1991-01-01',
      end: '2004-06-01',
      thesis: 'The infrastructure ministry grew faster than its oversight mechanisms.',
      accent: '#2b6cb0'
    },
    broken: [
      { name: 'a colour that is not a hex code', record: { id: 'era-1', label_en: 'An era', start: '1991-01-01', end: '2004-06-01', thesis: 'A long enough era thesis.', accent: 'blue' }, rule: 'V19' },
      { name: 'a malformed start token', record: { id: 'era-2', label_en: 'An era', start: '1991ish', end: '2004-06-01', thesis: 'A long enough era thesis.', accent: '#2b6cb0' }, rule: 'V19' },
      { name: 'an undeclared key', record: { id: 'era-3', label_en: 'An era', start: '1991-01-01', end: '2004-06-01', thesis: 'A long enough era thesis.', accent: '#2b6cb0', colour: 'blue' }, rule: 'V19' }
    ]
  }
];

// ---------------------------------------------------------------------------------------------
// One battery per kind
// ---------------------------------------------------------------------------------------------

for (const { kind, valid, sourcesRule = 'V19', broken } of cases) {
  const withEnvelope = !['role', 'era'].includes(kind);
  const allBroken = withEnvelope ? [...broken, ...envelopeBattery(kind, valid, sourcesRule)] : broken;

  const clean = parseOne(kind, valid);
  assert(
    `${kind}: a valid record parses with no finding`,
    clean.findings.length === 0,
    clean.findings.map((f) => f.message).join(' | ')
  );
  assert(
    `${kind}: the valid record is kept with its defaults`,
    clean.records[kind].length === 1,
    JSON.stringify(clean.records[kind])
  );

  for (const bad of allBroken) {
    const found = recordFindings(kind, bad.record);
    const hit = found.find((f) => f.rule === bad.rule);
    assert(
      `${kind}: ${bad.name} is a ${bad.rule} finding`,
      !!hit,
      found.map((f) => `${f.rule} ${f.message}`).join(' | ')
    );
    if (bad.message) {
      assert(
        `${kind}: ${bad.name} carries its published message`,
        found.some((f) => f.message.includes(bad.message as string)),
        found.map((f) => f.message).join(' | ')
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The envelope's own refinement battery is complete on one kind, and its
// issues keep the consumer's order: envelope first, kind refinements after.
// ---------------------------------------------------------------------------------------------

{
  const allegation = recordFindings('relationship', cases[4].broken[0].record);
  assert(
    'an unsourced allegation reports the envelope before its own refinement',
    allegation.length === 2 && allegation[0].rule === 'V12' && allegation[1].rule === 'V19',
    allegation.map((f) => `${f.rule} ${f.message}`).join(' | ')
  );
}

// ---------------------------------------------------------------------------------------------
// The example dataset parses as a whole
// ---------------------------------------------------------------------------------------------

{
  const dataDir = join(ROOT, 'examples', 'ruritania', 'data');
  const raw: Record<string, unknown[]> = {};
  for (const def of engine.kinds.values()) {
    const path = join(dataDir, def.file);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseYaml(text);
    raw[def.kind] = Array.isArray(parsed) ? parsed : [];
  }
  const result = engine.parse(raw as RawDataset);
  assert(
    'the Ruritania example dataset parses with no finding',
    result.findings.length === 0,
    result.findings.map((f) => `${f.rule} ${f.message}`).join(' | ')
  );
  for (const def of engine.kinds.values()) {
    assert(
      `the example keeps every ${def.kind} record`,
      (result.records[def.kind] ?? []).length === (raw[def.kind] ?? []).length
    );
  }
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
