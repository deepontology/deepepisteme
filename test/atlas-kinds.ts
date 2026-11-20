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
      },
      {
        name: 'an equity share above 100 percent',
        record: { id: 'rel-5', from: 'elena-varn', to: 'inst-ministry-infra', type: 'ownership', description: 'A stake recorded above the whole.', confidence: 'B', sources: ['herald-ruritania-2024-03-10'], equity: { pct: 100.5 } },
        rule: 'V19',
        message: 'equity.pct'
      },
      {
        name: 'a negative equity share',
        record: { id: 'rel-6', from: 'elena-varn', to: 'inst-ministry-infra', type: 'ownership', description: 'A stake recorded below nothing.', confidence: 'B', sources: ['herald-ruritania-2024-03-10'], equity: { pct: -1 } },
        rule: 'V19',
        message: 'equity.pct'
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
  },
  {
    kind: 'agreement',
    sourcesRule: 'V19',
    valid: {
      id: 'agr-free-trade-2020',
      title_en: 'Free trade agreement with two neighbours',
      kind: 'free-trade',
      parties: ['FR', 'DE'],
      signed: '2020-05-01',
      in_force: '2021-01-01',
      summary: 'A free trade agreement signed with two neighbouring states.',
      confidence: 'B',
      sources: ['gazette-2022-decree-44']
    },
    broken: [
      { name: 'no party', record: { id: 'agr-1', title_en: 'A title', kind: 'free-trade', parties: [], summary: 'A long enough summary.', confidence: 'B', sources: ['gazette-2022-decree-44'] }, rule: 'V19', message: 'an agreement needs at least one party' },
      { name: 'a kind outside the vocabulary', record: { id: 'agr-2', title_en: 'A title', kind: 'friendship-pact', parties: ['FR'], summary: 'A long enough summary.', confidence: 'B', sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'a malformed signature date', record: { id: 'agr-3', title_en: 'A title', kind: 'free-trade', parties: ['FR'], signed: 'May 2020', summary: 'A long enough summary.', confidence: 'B', sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'a party that is neither a code nor an id', record: { id: 'agr-4', title_en: 'A title', kind: 'free-trade', parties: ['Not A Party'], summary: 'A long enough summary.', confidence: 'B', sources: ['gazette-2022-decree-44'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'world-claim',
    sourcesRule: 'V19',
    valid: {
      id: 'wc-debt-total-2024',
      entity: null,
      claim: 'The total public debt reached a stated share of output in 2024.',
      assessment: 'The recorded figure and its boundary are stated beside the claim.',
      confidence: 'B',
      sources: ['ruritania-statistical-office-2023']
    },
    broken: [
      { name: 'a claim under ten characters', record: { id: 'wc-1', claim: 'Short.', assessment: 'A long enough assessment.', confidence: 'B', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' },
      { name: 'an assessment under ten characters', record: { id: 'wc-2', claim: 'A long enough claim here.', assessment: 'Short.', confidence: 'B', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' },
      { name: 'an entity that is not an id', record: { id: 'wc-3', entity: 'Not A Slug', claim: 'A long enough claim here.', assessment: 'A long enough assessment.', confidence: 'B', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'company',
    sourcesRule: 'V19',
    valid: {
      id: 'comp-ruritania-railways',
      legal_name_en: 'Ruritanian Railways Ltd',
      legal_form: 'state company',
      registration: { registry: 'company-register', number: 'CRN-1001', date: '1962-09-01' },
      state_owned: true,
      activities: ['rail transport'],
      notes: ['The register lists the company under its founding decree.'],
      sources: ['gazette-2022-decree-44']
    },
    broken: [
      { name: 'a registry outside the deployment list', record: { id: 'comp-1', registration: { registry: 'offshore-register', number: '1', date: '2020-01-01' }, sources: ['gazette-2022-decree-44'] }, rule: 'V19', message: "registry must be one of the jurisdiction's registries" },
      { name: 'a negative capital', record: { id: 'comp-2', capital: { tnd: -5, date: '2020-01-01' }, sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'a status outside the taxonomy', record: { id: 'comp-3', status: 'bankrupt', sources: ['gazette-2022-decree-44'] }, rule: 'V19' },
      { name: 'an undeclared key', record: { id: 'comp-4', turnover: 'high', sources: ['gazette-2022-decree-44'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'contract',
    sourcesRule: 'V19',
    valid: {
      id: 'ctr-rail-concession-2024',
      title_en: 'Rail concession award',
      institution: 'ministry-infrastructure',
      kind: 'concession',
      procurement: { mechanism: 'open-tender', advertised: '2024-01-15' },
      award: { value: '400000000', currency: 'EUR', year: 2024 },
      winner: 'comp-ruritania-railways',
      status: 'signed',
      start: '2024-06-01',
      sources: ['gazette-2024-decree-11']
    },
    broken: [
      { name: 'a missing status', record: { id: 'ctr-1', title_en: 'A contract', institution: 'ministry-infrastructure', kind: 'concession', sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a kind outside the taxonomy', record: { id: 'ctr-2', title_en: 'A contract', institution: 'ministry-infrastructure', kind: 'gift', status: 'signed', sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a lowercase award currency', record: { id: 'ctr-3', title_en: 'A contract', institution: 'ministry-infrastructure', kind: 'concession', award: { value: '10', currency: 'eur', year: 2024 }, status: 'signed', sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'an award year before the floor', record: { id: 'ctr-4', title_en: 'A contract', institution: 'ministry-infrastructure', kind: 'concession', award: { value: '10', currency: 'EUR', year: 1850 }, status: 'signed', sources: ['gazette-2024-decree-11'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'licence',
    sourcesRule: 'V19',
    valid: {
      id: 'lic-rail-spectrum-2020',
      holder: 'comp-ruritania-railways',
      issuer: 'ministry-infrastructure',
      kind: 'spectrum',
      grant: '2020-07-01',
      term: { years: 15 },
      scope: { region: 'Ruritania' },
      fees: { amount: 257251000, currency: 'EUR', year: 2020 },
      status: 'active',
      sources: ['gazette-2024-decree-11']
    },
    broken: [
      { name: 'a missing grant date', record: { id: 'lic-1', holder: 'comp-ruritania-railways', issuer: 'ministry-infrastructure', kind: 'spectrum', sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a term of zero years', record: { id: 'lic-2', holder: 'comp-ruritania-railways', issuer: 'ministry-infrastructure', kind: 'spectrum', grant: '2020-07-01', term: { years: 0 }, sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a scope with no region', record: { id: 'lic-3', holder: 'comp-ruritania-railways', issuer: 'ministry-infrastructure', kind: 'spectrum', grant: '2020-07-01', scope: { frequency: 'annual' }, sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a kind outside the taxonomy', record: { id: 'lic-4', holder: 'comp-ruritania-railways', issuer: 'ministry-infrastructure', kind: 'hunting', grant: '2020-07-01', sources: ['gazette-2024-decree-11'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'vacancy',
    sourcesRule: 'V19',
    valid: {
      id: 'vac-infra-deputy-2024',
      role: 'role-infra-deputy',
      start: '2024-03-10',
      end: '2024-09-01',
      notes: ['The first delegate managed the office meanwhile.'],
      sources: ['herald-ruritania-2024-03-10']
    },
    broken: [
      { name: 'a missing end date', record: { id: 'vac-1', role: 'role-infra-deputy', start: '2024-03-10', sources: ['herald-ruritania-2024-03-10'] }, rule: 'V19' },
      { name: 'a malformed start date', record: { id: 'vac-2', role: 'role-infra-deputy', start: 'March 2024', end: '2024-09-01', sources: ['herald-ruritania-2024-03-10'] }, rule: 'V19' },
      { name: 'a missing role', record: { id: 'vac-3', start: '2024-03-10', end: '2024-09-01', sources: ['herald-ruritania-2024-03-10'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'declaration',
    sourcesRule: 'V19',
    valid: {
      id: 'decl-ministers-2024',
      declarer: 'elena-varn',
      date: '2024-04-01',
      kind: 'asset-declaration',
      jurisdiction: 'ruritania',
      body: null,
      summary: 'The minister filed the annual asset declaration with the register.',
      sources: ['gazette-2024-decree-11']
    },
    broken: [
      { name: 'a missing declarer', record: { id: 'decl-1', date: '2024-04-01', kind: 'asset-declaration', jurisdiction: 'ruritania', body: null, summary: 'A summary.', sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a kind outside the taxonomy', record: { id: 'decl-2', declarer: 'elena-varn', date: '2024-04-01', kind: 'tax-return', jurisdiction: 'ruritania', body: null, summary: 'A summary.', sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a body that is not an id', record: { id: 'decl-3', declarer: 'elena-varn', date: '2024-04-01', kind: 'asset-declaration', jurisdiction: 'ruritania', body: 'Not A Slug', summary: 'A summary.', sources: ['gazette-2024-decree-11'] }, rule: 'V19' },
      { name: 'a missing date', record: { id: 'decl-4', declarer: 'elena-varn', kind: 'asset-declaration', jurisdiction: 'ruritania', body: null, summary: 'A summary.', sources: ['gazette-2024-decree-11'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'education',
    sourcesRule: 'V19',
    valid: {
      id: 'edu-varn-midland',
      person: 'elena-varn',
      institution: 'midland-university',
      degree_en: 'Licence in civil engineering',
      kind: 'licence',
      start: '1998',
      end: '2002',
      sources: ['ruritania-statistical-office-2023']
    },
    broken: [
      { name: 'a missing person', record: { id: 'edu-1', institution: 'midland-university', degree_en: 'A degree', kind: 'licence', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' },
      { name: 'a kind outside the taxonomy', record: { id: 'edu-2', person: 'elena-varn', institution: 'midland-university', degree_en: 'A degree', kind: 'doctorate', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' },
      { name: 'an empty degree', record: { id: 'edu-3', person: 'elena-varn', institution: 'midland-university', degree_en: '', kind: 'licence', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' },
      { name: 'a malformed end date', record: { id: 'edu-4', person: 'elena-varn', institution: 'midland-university', degree_en: 'A degree', kind: 'licence', end: ' graduation', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'place',
    sourcesRule: 'V19',
    valid: {
      id: 'place-rivertown-port',
      kind: 'port',
      name_en: 'Port of Rivertown',
      coordinates: [16.1, 46.2],
      asset: true,
      sources: ['ruritania-statistical-office-2023']
    },
    broken: [
      { name: 'a kind outside the vocabulary', record: { id: 'pl-1', kind: 'volcano', name_en: 'A place', sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' },
      { name: 'coordinates outside the deployment box', record: { id: 'pl-2', kind: 'port', name_en: 'A place', coordinates: [20, 50], sources: ['ruritania-statistical-office-2023'] }, rule: 'V19', message: 'coordinates must fall inside Ruritania' },
      { name: 'a single coordinate', record: { id: 'pl-3', kind: 'port', name_en: 'A place', coordinates: [16.1], sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' },
      { name: 'coordinates as text', record: { id: 'pl-4', kind: 'port', name_en: 'A place', coordinates: ['16.1', '46.2'], sources: ['ruritania-statistical-office-2023'] }, rule: 'V19' }
    ]
  },
  {
    kind: 'group-layer',
    valid: {
      layer: 'political',
      subsections: [
        { header_en: 'Cabinet', membership: { type: 'ministry' } },
        { header_en: 'Parties', membership: { role_prefix: 'role-union' } }
      ]
    },
    broken: [
      {
        name: 'a membership rule with no matcher',
        record: { layer: 'political', subsections: [{ header_en: 'Cabinet', membership: {} }] },
        rule: 'V19',
        message: 'membership rule must have at least one of: role, role_prefix, type, members'
      },
      { name: 'a layer outside the vocabulary', record: { layer: 'naval', subsections: [{ header_en: 'Cabinet', membership: { type: 'ministry' } }] }, rule: 'V19' },
      { name: 'no subsections', record: { layer: 'political', subsections: [] }, rule: 'V19' },
      { name: 'a subsection with no header', record: { layer: 'political', subsections: [{ membership: { type: 'ministry' } }] }, rule: 'V19' }
    ]
  }
];

// ---------------------------------------------------------------------------------------------
// One battery per kind
// ---------------------------------------------------------------------------------------------

for (const { kind, valid, sourcesRule = 'V19', broken } of cases) {
  const withEnvelope = !['role', 'era', 'group-layer'].includes(kind);
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

// V13: both halves have a control that differs by the one field alone.
{
  const edge = (id: string, extra: Record<string, unknown>) => ({
    id,
    from: 'elena-varn',
    to: 'inst-ministry-infra',
    type: 'ownership',
    description: 'A stake recorded by the register.',
    confidence: 'B',
    sources: ['herald-ruritania-2024-03-10'],
    ...extra
  });
  const parse = (record: Record<string, unknown>) => engine.parse({ relationship: [record] } as RawDataset);
  assert('V13: an equity share of exactly 100 percent parses clean', parse(edge('rel-c1', { equity: { pct: 100 } })).findings.length === 0);
  assert('V13: an equity share of exactly 0 percent parses clean', parse(edge('rel-c2', { equity: { pct: 0 } })).findings.length === 0);
  assert('V13: an equity share of 100.5 is refused and the record is dropped', (() => {
    const r = parse(edge('rel-c3', { equity: { pct: 100.5 } }));
    return r.findings.length === 1 && r.findings[0].record?.id === 'rel-c3' && (r.records.relationship ?? []).length === 0;
  })());
  assert('V13: finance on a funding edge parses clean', parse(edge('rel-c4', { type: 'funding', finance: { amount: 10, currency: 'EUR', year: 2024 } })).findings.length === 0);
  assert('V13: finance on an ownership edge parses clean', parse(edge('rel-c5', { finance: { amount: 10, currency: 'EUR', year: 2024 } })).findings.length === 0);
  assert('V13: finance on a board edge is refused', parse(edge('rel-c6', { type: 'board', finance: { amount: 10, currency: 'EUR', year: 2024 } })).findings.length === 1);
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
