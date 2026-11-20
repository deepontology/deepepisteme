/**
 * test/match.ts: the name matcher's behavior checks.
 *
 * The matcher exists so headlines can link into a graph WITHOUT a language
 * model: a hallucinated link between a named person and a news story is the
 * one failure this project cannot survive. That makes precision the thing
 * under test here, not recall. A matcher that finds half the mentions is
 * merely incomplete; one that confidently links the wrong person has
 * manufactured an insinuation, which is exactly what the evidence envelope
 * exists to prevent.
 *
 * Entities come from the example jurisdiction's own data files, plus fixtures
 * for the naming conventions the deployment's word lists exist to serve
 * (nasab particles, shared surnames, ambiguous forms). Headlines are
 * hard-coded so the suite stays deterministic and offline. The orthographic
 * folding checks exercise the atlas machinery itself — script folding is
 * engine code, and holds for any deployment writing in those scripts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { createEngine, type MatchEntity } from '../src/engine.ts';
import { normalise } from '../src/atlas/match.ts';
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

// ---------------------------------------------------------------------------
// The entity set: the example jurisdiction's own records, plus the fixtures
// that carry the particle conventions.
// ---------------------------------------------------------------------------

interface PersonYaml {
  id: string;
  name_en: string;
  aliases?: string[];
}
interface InstitutionYaml {
  id: string;
  name_en: string;
  abbr?: string;
}

const people = parseYaml(readFileSync(join(ROOT, 'data', 'people.yaml'), 'utf8')) as PersonYaml[];
const institutions = parseYaml(
  readFileSync(join(ROOT, 'data', 'institutions.yaml'), 'utf8')
) as InstitutionYaml[];

const entities: MatchEntity[] = [
  ...people.map((p) => ({
    id: p.id,
    kind: 'person' as const,
    names: [p.name_en, ...(p.aliases ?? [])].filter(Boolean)
  })),
  ...institutions.map((i) => ({
    id: i.id,
    kind: 'institution' as const,
    names: [i.name_en, ...(i.abbr ? [i.abbr] : [])].filter(Boolean)
  })),
  // The fixtures. Names follow the conventions the deployment's word lists
  // describe; every one of them exercises a rule the data files do not reach.
  { id: 'sihem-benspring', kind: 'person', names: ['Sihem Benspring'] },
  { id: 'rudolf-benhal', kind: 'person', names: ['Rudolf Ben Hal'] },
  { id: 'greta-mebaz', kind: 'person', names: ['Greta Mebaz'] },
  { id: 'peter-kern', kind: 'person', names: ['Peter Kern'] },
  { id: 'jan-reiner', kind: 'person', names: ['Jan Reiner'] },
  { id: 'the-gauge', kind: 'institution', names: ['The Gauge'] },
  { id: 'herald-north', kind: 'institution', names: ['Ruritania Herald'] },
  { id: 'herald-south', kind: 'institution', names: ['Ruritania Herald'] },
  { id: 'wahris-palace', kind: 'institution', names: ['قصر الواحة'] },
  { id: 'al-radar', kind: 'institution', names: ['الرادار'] }
];

const engine = createEngine(ruritania);
const m = engine.match(entities);
const ids = (text: string) => m.find(text).map((x) => x.id);
const has = (text: string, id: string) => ids(text).includes(id);

// --- Normalisation: the atlas folding machinery ------------------------------

assert('latin diacritics fold', normalise('Eléna Värn') === normalise('Elena Varn'));
assert(
  'letters without a decomposition fold',
  normalise('Đorđe Øberg') === normalise('Dorde Oberg'),
  'đ -> d, ø -> o come from the fold table, not NFKD'
);
assert('case folds', normalise('VARN') === normalise('varn'));
assert(
  'arabic tashkeel folds',
  normalise('قَصْر الوَاحَة') === normalise('قصر الواحة'),
  'marks are stripped with the letters kept whole'
);
assert('alef variants fold', normalise('أحمد') === normalise('احمد'));
assert('taa marbuta folds', normalise('حركة') === normalise('حركه'));

// --- True positives -----------------------------------------------------------

assert('matches a full latin name', has('Elena Varn opens the Rivertown rail concession', 'elena-varn'));
assert(
  'matches an authored alias',
  has('M. Tell defends the rail budget', 'marco-tell'),
  'authored alias "M. Tell"'
);
assert('matches an institution by full name', has('Midland University hosts the rail summit', 'midland-university'));
assert(
  'matches an acronym institution',
  has('MOI publishes the rail decree', 'ministry-infrastructure'),
  'the abbreviation is an authored name field'
);
assert(
  'particle-split: authored "Benspring", headline "Ben Spring"',
  has('Sihem Ben Spring named to the rail regulator', 'sihem-benspring'),
  'rule particle-split'
);
assert(
  'particle-join: authored "Ben Hal", headline "Benhal"',
  has('Rudolf Benhal addressed the assembly', 'rudolf-benhal'),
  'rule particle-join'
);
assert(
  'the longest form wins at a position',
  m.find('Rudolf Ben Hal addressed the assembly').length === 1 &&
    m.find('Rudolf Ben Hal addressed the assembly')[0]?.rule === 'authored',
  'the authored three-token form consumes the span before the surname form can fire'
);
assert(
  'matches an arabic name carrying tashkeel and an added article',
  has('افتتح القَصْر الواحة الجديد', 'wahris-palace'),
  'authored "قصر الواحة"; the headline writes "القصر" with tashkeel'
);

// --- The surname rule --------------------------------------------------------

const lone = m.find('Mebaz: the rail concession is signed');
assert(
  'surname-only matches are labelled as such',
  lone.length > 0 && lone.every((x) => x.rule === 'surname') && lone[0]?.id === 'greta-mebaz',
  lone.map((x) => `${x.id}:${x.rule}`).join(', ') || 'no match'
);
assert(
  'a surname shared by several people does not match on its own',
  ids('Kern: the party leader met the president').length === 0,
  '"Kern" is carried by two people, so the stoplist refuses it'
);

// --- True negatives. These matter more than the positives above. -------------

assert(
  'a bare common given name matches nobody',
  ids('Jan opened the session').length === 0,
  JSON.stringify(ids('Jan opened the session'))
);
assert('a generic headline matches nobody', ids('Weather: rain over the northern provinces').length === 0);
assert('a bare particle matches nobody', ids('Ben, El, Bin').length === 0, JSON.stringify(ids('Ben, El, Bin')));
assert(
  'an ordinary arabic sentence matches nobody',
  ids('ارتفاع أسعار الخضر والغلال في الأسواق').length === 0,
  JSON.stringify(ids('ارتفاع أسعار الخضر والغلال في الأسواق'))
);
assert(
  'lowercase prose does not trip the single-token gate',
  ids('readings in the gauge fall again').length === 0,
  '"The Gauge" is an institution; without capitalisation it must not fire'
);
assert(
  'the same name capitalised does match',
  has('readings in The Gauge rise again', 'the-gauge')
);
assert(
  'a lone caseless word with no cased single-word name behind it is refused',
  m.formsFor('al-radar').length === 0 && ids('الرادار').length === 0,
  m.rejectionsFor('al-radar').join('; ') || 'no rejection recorded'
);

// --- Ambiguity: a form two entities claim is withdrawn from both -------------

assert(
  'a single ambiguous surface form is refused, not guessed',
  ids('Ruritania Herald').length === 0,
  '"Ruritania Herald" is claimed by two institutions; both are refused'
);
assert(
  'an ambiguous surface form is claimed by nobody',
  [...m.ambiguous.values()].every((owners) => owners.length > 1),
  `${m.ambiguous.size} refused as ambiguous`
);

// --- Structural guarantees ----------------------------------------------------

const overlapping = m.find('Elena Varn and Marco Tell met at Midland University');
assert(
  'matches never overlap',
  overlapping.length === 3 &&
    overlapping.every((a, i) =>
      overlapping.slice(i + 1).every((b) => a.end <= b.start || b.end <= a.start)
    ),
  overlapping.map((x) => x.text).join(' | ')
);
assert('offsets index the original text', overlapping.every((x) => x.text.length === x.end - x.start));
assert(
  'the stoplist is derived, not hand-written',
  m.stoplist.size > 10,
  `${m.stoplist.size} tokens: every particle, every function word, and the names two entities share`
);
assert(
  'a two-letter abbreviation is refused as too short',
  m.rejectionsFor('ruritania-railways').some((r) => r.includes('"rr"')),
  m.rejectionsFor('ruritania-railways').join('; ')
);
assert('single-token rejections are recorded', m.stats.rejectedSingletons > 0, `${m.stats.rejectedSingletons} refused`);

// --- Two engines, different word lists, one process ---------------------------

{
  const vanHolt: MatchEntity[] = [{ id: 'jan-van-holt', kind: 'person', names: ['Jan van Holt'] }];
  const withoutVan = createEngine(ruritania);
  const withVan = createEngine({
    ...ruritania,
    matcher: { ...ruritania.matcher, surnameHeads: [...ruritania.matcher.surnameHeads, 'van'] }
  });
  const here = withoutVan.match(vanHolt).find('Van Holt addressed the chamber.');
  const there = withVan.match(vanHolt).find('Van Holt addressed the chamber.');
  assert(
    'two engines with different word lists answer differently',
    here.length === 1 &&
      there.length === 1 &&
      here[0]?.text === 'Holt' &&
      there[0]?.text === 'Van Holt',
    `without "van" as a surname head: ${here.map((x) => x.text).join(' | ')}; with it: ${there
      .map((x) => x.text)
      .join(' | ')}`
  );
  assert(
    'the first engine still answers with its own lists after the second is built',
    withoutVan.match(vanHolt).find('Van Holt addressed the chamber.')[0]?.text === 'Holt'
  );
}

// --- Summary ------------------------------------------------------------------

console.log(
  `\n  matchable ${m.stats.matchable}/${m.stats.entities} entities · ${m.stats.forms} surface forms · ` +
    `${m.stats.rejectedSingletons} single-token forms refused · stoplist ${m.stats.stoplist}`
);
console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
