/**
 * test/splicer.ts: assertions over the YAML patch splicer.
 *
 * The splicer writes a canonical dataset, so the assertion that matters is not
 * "did the edit work" but "did anything ELSE change". A splicer that quietly
 * reformats the file it touches would put an unreviewable diff in front of a
 * reviewer and, sooner or later, corrupt data nobody was looking at.
 *
 * So most of what follows checks the file OUTSIDE the edit. The tests that
 * assert a change landed are the easy half; the tests that assert every other
 * byte is still identical are the ones worth having.
 *
 * Fixtures are synthetic Ruritanian records under test/fixtures, read from disk
 * and never written back. They keep the shapes the real files have: a folded
 * block scalar, a flow list, a block list of maps, records with and without an
 * id, mostly CRLF with a few bare LFs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { EmitError, type Edit } from '../src/kernel/splicer.ts';
import { createEngine } from '../src/engine.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(HERE, 'fixtures', f), 'utf8');

const { splicer } = createEngine(ruritania);
const { applyEdit, assertOnlyTargetChanged } = splicer;

let failures = 0;
let checks = 0;

function ok(name: string, condition: boolean, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function throws(name: string, fn: () => unknown, expect: string) {
  checks++;
  try {
    fn();
    failures++;
    console.error(`  FAIL  ${name}: expected an error, got none`);
  } catch (e) {
    const message = (e as Error).message;
    const right = e instanceof EmitError && message.includes(expect);
    if (right) console.log(`  ok    ${name}: ${message}`);
    else {
      failures++;
      console.error(`  FAIL  ${name}: wrong error: ${message}`);
    }
  }
}

/**
 * The core assertion. Everything before and after the changed region must be the
 * original bytes, and the change must be one contiguous run.
 */
function untouchedOutside(before: string, after: string, start: number, end: number, added: string) {
  return (
    before.slice(0, start) === after.slice(0, start) &&
    before.slice(end) === after.slice(start + added.length) &&
    after.slice(start, start + added.length) === added
  );
}

const people = read('people.yaml');
const positions = read('positions.yaml');

console.log('\n  -- the file outside the edit --\n');

// --- set -------------------------------------------------------------------

{
  const before = people;
  const { text, splice } = applyEdit(before, {
    op: 'set',
    target: { id: 'vodrik' },
    field: 'tagline',
    value: 'Changed for the test'
  });

  ok(
    'set: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok(
    'set: the rest of the file is the same length',
    before.length - splice.replaced.length === text.length - splice.text.length
  );
  ok(
    'set: new value reads back',
    (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik').tagline === 'Changed for the test'
  );
  ok(
    'set: neighbouring records are identical',
    (parseDocument(text).toJS() as any[]).find((r) => r.id === 'halbeck').tagline ===
      (parseDocument(before).toJS() as any[]).find((r) => r.id === 'halbeck').tagline
  );
  ok('set: one line changed', text.split('\n').length === before.split('\n').length);
}

// --- add-field -------------------------------------------------------------

{
  const before = people;
  const { text, splice } = applyEdit(before, {
    op: 'add-field',
    target: { id: 'vodrik' },
    field: 'verification',
    value: 'needs-primary-source'
  });

  ok(
    'add-field: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok('add-field: adds exactly one line', text.split('\n').length === before.split('\n').length + 1);
  ok(
    'add-field: value reads back',
    (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik').verification === 'needs-primary-source'
  );
  ok(
    'add-field: record keeps every prior field',
    Object.keys((parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik')).length ===
      Object.keys((parseDocument(before).toJS() as any[]).find((r) => r.id === 'vodrik')).length + 1
  );
}

// --- append-to-list --------------------------------------------------------

{
  const before = people;
  const { text, splice } = applyEdit(before, {
    op: 'append-to-list',
    target: { id: 'vodrik' },
    field: 'sources',
    item: 'gazette-1957-01'
  });

  ok(
    'append-to-list: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok('append-to-list: no new lines', text.split('\n').length === before.split('\n').length);

  const after = (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik').sources;
  ok('append-to-list: item appended last', after[after.length - 1] === 'gazette-1957-01');
  ok('append-to-list: existing entries survive', after.includes('archive-vodrik'));

  // Flow style must survive: rewriting [a, b] as a block list would be a
  // whole-record reformat dressed up as an append.
  ok('append-to-list: stays a flow sequence', /sources: \[.*gazette-1957-01\]/.test(text));
}

// --- append-object ---------------------------------------------------------

{
  const before = positions;
  const { text, splice } = applyEdit(before, {
    op: 'append-object',
    target: { id: 'p-interior-vodrik' },
    field: 'disputes',
    item: { claim: 'A third, test-only reading of the appointment date', held_by: 'Test fixture', status: 'open' }
  });

  ok(
    'append-object: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok('append-object: adds three lines', text.split('\n').length === before.split('\n').length + 3);

  const after = (parseDocument(text).toJS() as any[]).find((r) => r.id === 'p-interior-vodrik');
  ok('append-object: entry lands last', after.disputes[after.disputes.length - 1].claim.startsWith('A third'));
  ok(
    'append-object: existing entries survive unchanged',
    after.disputes.length === 3 && after.disputes[0].status === 'open'
  );
  ok(
    'append-object: the appended entry reads back',
    after.disputes[2].held_by === 'Test fixture' && after.disputes[2].status === 'open'
  );
  ok(
    'append-object: neighbouring records are identical',
    JSON.stringify((parseDocument(text).toJS() as any[]).find((r) => r.id === 'p-courts-halbeck')) ===
      JSON.stringify((parseDocument(before).toJS() as any[]).find((r) => r.id === 'p-courts-halbeck'))
  );
}

// --- remove-field ----------------------------------------------------------

{
  const before = people;
  const { text, splice } = applyEdit(before, {
    op: 'remove-field',
    target: { id: 'vodrik' },
    field: 'tagline'
  });

  ok(
    'remove-field: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok('remove-field: removes exactly one line', text.split('\n').length === before.split('\n').length - 1);

  const after = (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik');
  ok('remove-field: field is gone', !('tagline' in after));
  ok(
    'remove-field: the record keeps its other fields',
    after.name_en === 'Aleks Vodrik' && after.death === '2000-04-06'
  );
  ok(
    'remove-field: neighbouring records are identical',
    JSON.stringify((parseDocument(text).toJS() as any[]).find((r) => r.id === 'halbeck')) ===
      JSON.stringify((parseDocument(before).toJS() as any[]).find((r) => r.id === 'halbeck'))
  );
}

{
  // The real use: a field whose value is a block scalar. The whole field and the
  // line break that ended it must go, or the next key glues onto the removed
  // value's last line and the file stops parsing.
  const before = people;
  const { text, splice } = applyEdit(before, {
    op: 'remove-field',
    target: { id: 'vodrik' },
    field: 'summary'
  });

  ok(
    'remove-field block scalar: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );

  const after = (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik');
  ok('remove-field block scalar: field is gone', !('summary' in after));
  ok('remove-field block scalar: next field survives', after.summary_fr.startsWith('Un texte replié'));
  ok(
    'remove-field block scalar: neighbours are identical',
    JSON.stringify((parseDocument(text).toJS() as any[]).find((r) => r.id === 'halbeck')) ===
      JSON.stringify((parseDocument(before).toJS() as any[]).find((r) => r.id === 'halbeck'))
  );
}

// --- add-block -------------------------------------------------------------

{
  const before = positions;
  const first = (parseDocument(before).toJS() as any[])[0];
  const { text, splice } = applyEdit(before, {
    op: 'add-block',
    target: { id: first.id },
    field: 'review',
    entries: { by: 'test', date: '2026-07-29', method: 'checked against the gazette' }
  });

  ok(
    'add-block: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok('add-block: adds four lines', text.split('\n').length === before.split('\n').length + 4);

  const written = (parseDocument(text).toJS() as any[]).find((r) => r.id === first.id).review;
  ok('add-block: nests correctly', written?.by === 'test' && written?.date === '2026-07-29');
  ok('add-block: optional entry lands', written?.method === 'checked against the gazette');
}

// --- append-record ---------------------------------------------------------

{
  // Lists must serialise in flow style. The default is block, which put "- x" on
  // the same line as its key, and a ONE-element list has no newline in it, so it
  // slipped past the fits-on-one-line check and produced invalid YAML. Only
  // multi-element lists were ever caught.
  const one = applyEdit(people, {
    op: 'append-record',
    record: { id: 'test-one-source', name_en: 'One', confidence: 'C', sources: ['source-lone'] }
  });
  ok('append-record: a one-item list is flow style', /sources: \[source-lone\]/.test(one.text));
  ok(
    'append-record: a one-item list parses back as a list',
    Array.isArray((parseDocument(one.text).toJS() as any[]).find((r) => r.id === 'test-one-source').sources)
  );

  const many = applyEdit(people, {
    op: 'append-record',
    record: { id: 'test-two-sources', name_en: 'Two', confidence: 'C', layers: ['civic', 'judicial'] }
  });
  ok('append-record: a multi-item list is flow style', /layers: \[civic, judicial\]/.test(many.text));

  const before = people;
  const { text, splice } = applyEdit(before, {
    op: 'append-record',
    record: { id: 'test-person', name_en: 'Test Person', confidence: 'C' }
  });

  ok(
    'append-record: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok('append-record: the whole prior file is a prefix', text.startsWith(before.replace(/[\r\n]+$/, '')));

  const records = parseDocument(text).toJS() as any[];
  ok('append-record: record count grows by one', records.length === (parseDocument(before).toJS() as any[]).length + 1);
  ok('append-record: appended last', records[records.length - 1].id === 'test-person');
  ok('append-record: fields land', records[records.length - 1].name_en === 'Test Person');
}

console.log('\n  -- line endings, quoting, formatting --\n');

{
  // The fixture is mostly CRLF with a few bare LFs, like a file that has been
  // hand edited. The test is not "the file is all CRLF": that would assert the
  // file's history rather than the splicer. It is that the splicer adds lines in
  // the prevailing style and disturbs no existing ending. Normalising the file
  // would show every line as changed in git, which is the unreviewable diff this
  // module exists to prevent.
  const count = (s: string, re: RegExp) => (s.match(re) || []).length;
  const before = people;
  const { text } = applyEdit(before, {
    op: 'add-block',
    target: { id: 'vodrik' },
    field: 'review',
    entries: { by: 'test', date: '2026-07-29' }
  });

  const addedLines = text.split('\n').length - before.split('\n').length;
  ok(
    'inserted lines use the prevailing CRLF',
    count(text, /\r\n/g) === count(before, /\r\n/g) + addedLines,
    `+${addedLines}`
  );
  ok(
    'pre-existing bare LFs are untouched',
    count(text, /[^\r]\n/g) === count(before, /[^\r]\n/g),
    `${count(before, /[^\r]\n/g)} of them`
  );
}

{
  // A date must stay a string. YAML would read 1903-08-03 unquoted as a date,
  // and the schema expects a string: exactly the silent type change a naive
  // splicer introduces.
  const { text } = applyEdit(people, {
    op: 'set',
    target: { id: 'vodrik' },
    field: 'birth',
    value: '1903-08-04'
  });
  const value = (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik').birth;
  ok('dates stay strings', typeof value === 'string', `got ${typeof value}: ${value}`);

  // Asserting the round-trip is not enough: it passes with the same library that
  // wrote the file. Unquoted `1903-08-04` is a string under YAML 1.2 and a
  // timestamp under 1.1, and files this module writes are published exports
  // others parse.
  ok('dates are written quoted', text.includes('birth: "1903-08-04"'));

  for (const token of ['2004', '~1995', '?', '<=1987-06']) {
    const out = applyEdit(people, {
      op: 'set',
      target: { id: 'vodrik' },
      field: 'birth',
      value: token
    });
    ok(`fuzzy token ${token} is quoted`, out.text.includes(`birth: ${JSON.stringify(token)}`));
  }

  // ...but a bare keyword is not, because the files do not quote those.
  const ongoing = applyEdit(people, {
    op: 'set',
    target: { id: 'vodrik' },
    field: 'death',
    value: 'ongoing'
  });
  ok('a plain keyword stays unquoted', ongoing.text.includes('death: ongoing'));
}

{
  // Long prose must not be folded into extra lines by the splicer.
  const long = 'A tagline long enough that any default folding width would wrap it across two lines or more.';
  const { text } = applyEdit(people, { op: 'set', target: { id: 'vodrik' }, field: 'tagline', value: long });
  ok('long values are not folded', text.split('\n').length === people.split('\n').length);
}

{
  // A value carrying a colon would break the file if written bare.
  const { text } = applyEdit(people, {
    op: 'set',
    target: { id: 'vodrik' },
    field: 'tagline',
    value: 'Interior minister: architect of the party-state'
  });
  const value = (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik').tagline;
  ok('values needing quotes are quoted', value === 'Interior minister: architect of the party-state');
}

console.log('\n  -- refusals --\n');

throws('unknown record id', () => applyEdit(people, { op: 'set', target: { id: 'nobody' }, field: 'tagline', value: 'x' }), 'no record with id');
throws('set on a missing field', () => applyEdit(people, { op: 'set', target: { id: 'vodrik' }, field: 'nope', value: 'x' }), 'use add-field');
throws('add-field over an existing field', () => applyEdit(people, { op: 'add-field', target: { id: 'vodrik' }, field: 'tagline', value: 'x' }), 'use set');
throws('duplicate list item', () => applyEdit(people, { op: 'append-to-list', target: { id: 'vodrik' }, field: 'sources', item: 'archive-vodrik' }), 'already in');
throws('append-to-list on a non-list', () => applyEdit(people, { op: 'append-to-list', target: { id: 'vodrik' }, field: 'tagline', item: 'x' }), 'not a list');
throws('duplicate record id', () => applyEdit(people, { op: 'append-record', record: { id: 'vodrik' } }), 'already exists');
throws('record without an id', () => applyEdit(people, { op: 'append-record', record: { name_en: 'x' } }), 'needs a string id');
throws('add-block over an existing field', () => applyEdit(people, { op: 'add-block', target: { id: 'vodrik' }, field: 'sources', entries: { a: 'b' } }), 'already has');
throws('empty block', () => applyEdit(people, { op: 'add-block', target: { id: 'vodrik' }, field: 'review', entries: {} }), 'is empty');
throws('remove-field on a missing field', () => applyEdit(people, { op: 'remove-field', target: { id: 'vodrik' }, field: 'nope' }), 'has no field');
throws('remove-field on a missing record', () => applyEdit(people, { op: 'remove-field', target: { id: 'nobody' }, field: 'tagline' }), 'no record with id');
throws('append-object on a non-list', () => applyEdit(people, { op: 'append-object', target: { id: 'vodrik' }, field: 'tagline', item: { a: 'b' } }), 'is not a list');
throws('append-object on a scalar list', () => applyEdit(people, { op: 'append-object', target: { id: 'vodrik' }, field: 'sources', item: { a: 'b' } }), 'is not a block list of objects');
throws('append-object with an empty object', () => applyEdit(people, { op: 'append-object', target: { id: 'vodrik' }, field: 'sources', item: {} }), 'needs at least one field');
throws('multi-line value', () => applyEdit(people, { op: 'set', target: { id: 'vodrik' }, field: 'tagline', value: 'one\ntwo' }), 'does not fit on one line');
// Mojibake must not reach canonical data: the replacement character means an
// earlier step decoded bytes it could not read and gave up.
throws(
  'value carrying the replacement character',
  () => applyEdit(people, { op: 'set', target: { id: 'vodrik' }, field: 'tagline', value: 'D\uFFFDcret' }),
  'U+FFFD'
);
// The real characters must still go through untouched, or the check is worse
// than the bug.
{
  const { text } = applyEdit(people, {
    op: 'set',
    target: { id: 'vodrik' },
    field: 'tagline',
    value: 'Décret réservé نص عربي'
  });
  ok(
    'accented and Arabic text survives',
    (parseDocument(text).toJS() as any[]).find((r) => r.id === 'vodrik').tagline === 'Décret réservé نص عربي'
  );
}

console.log('\n  -- the guard itself --\n');

{
  // The guard must fail on damage it is supposed to catch, or it is decoration.
  // A prefix and suffix comparison would accept a file with two separate edits
  // in it, because any two strings share a prefix and a suffix. These cases are
  // hand-built corruption, checked directly.
  const caught = (fn: () => void) => {
    try {
      fn();
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };

  const base = '- id: a\n  v: 1\n\n- id: b\n  v: 2\n\n- id: c\n  v: 3\n';

  ok(
    'guard catches an unrelated record being altered',
    caught(() => assertOnlyTargetChanged(base, base.replace('v: 3', 'v: 9'), 'a')).includes('altered unrelated record "c"')
  );
  ok(
    'guard catches an unrelated record being deleted',
    caught(() => assertOnlyTargetChanged(base, '- id: a\n  v: 1\n\n- id: c\n  v: 3\n', 'a')).includes('deleted unrelated record "b"')
  );
  ok(
    'guard catches reordering',
    caught(() => assertOnlyTargetChanged(base, '- id: b\n  v: 2\n\n- id: a\n  v: 1\n\n- id: c\n  v: 3\n', 'a')).includes('reordered')
  );
  ok(
    'guard catches an unexpected extra record',
    caught(() => assertOnlyTargetChanged(base, base + '\n- id: d\n  v: 4\n', 'a')).includes('record count went')
  );
  ok('guard allows the target to change', caught(() => assertOnlyTargetChanged(base, base.replace('v: 1', 'v: 9'), 'a')) === '');
  ok('guard allows exactly one append', caught(() => assertOnlyTargetChanged(base, base + '\n- id: d\n  v: 4\n', null)) === '');
}

console.log('\n  -- every record shape --\n');

{
  // The invariant must hold across record SHAPES, not just the hand-picked
  // records above, which were chosen because they work. Shape diversity is what
  // finds bugs here: a nested map, a folded block scalar, a record with one
  // field, the last record in a file. So this samples for shape across the
  // fixtures.
  const FILES = ['people.yaml', 'positions.yaml', 'relationships.yaml', 'unkeyed.yaml'];
  const CAP = 12;

  const withIds = (records: any[]) => records.map((r, i) => [r, i] as const).filter(([r]) => typeof r?.id === 'string');

  /** Indices chosen for shape: the edges, the extremes, then an even spread. */
  function sample(records: any[]): number[] {
    const identified = withIds(records);
    if (!identified.length) return [];

    const fieldCount = ([r]: readonly [any, number]) => Object.keys(r).length;
    const nested = ([r]: readonly [any, number]) =>
      Object.values(r).some((v) => v && typeof v === 'object' && !Array.isArray(v));
    const prose = ([r]: readonly [any, number]) =>
      Object.values(r).some((v) => typeof v === 'string' && v.length > 200);

    const picks = new Set<number>();
    const take = (entry?: readonly [any, number]) => entry && picks.add(entry[1]);

    take(identified[0]);
    take(identified[1]);
    take(identified[identified.length - 1]);
    take(identified[identified.length - 2]);
    take([...identified].sort((a, b) => fieldCount(b) - fieldCount(a))[0]);
    take([...identified].sort((a, b) => fieldCount(a) - fieldCount(b))[0]);
    take(identified.find(nested));
    take(identified.find(prose));

    const stride = Math.max(1, Math.floor(identified.length / CAP));
    for (let i = 0; i < identified.length && picks.size < CAP; i += stride) take(identified[i]);
    return [...picks];
  }

  let bad = 0;
  let swept = 0;
  let worst = '';

  for (const name of FILES) {
    const source = read(name);
    const records = parseDocument(source).toJS() as any[];
    for (const index of sample(records)) {
      const record = records[index];
      swept++;
      try {
        const edit: Edit = { op: 'add-field', target: { id: record.id }, field: 'zz_probe', value: 'probe' };
        const { text, splice } = applyEdit(source, edit);
        if (!untouchedOutside(source, text, splice.start, splice.end, splice.text)) {
          bad++;
          if (!worst) worst = `${name}:${record.id}`;
        }
      } catch (e) {
        bad++;
        if (!worst) worst = `${name}:${record.id} threw ${(e as Error).message}`;
      }
    }
  }

  ok(`sweep: ${swept} records across ${FILES.length} files splice cleanly`, bad === 0, bad ? `${bad} bad, first ${worst}` : '');
}

console.log('\n  -- records with no id --\n');

{
  // Positional targeting exists for a file whose records are not keyed, and it is
  // only safe because it verifies what it landed on: a stale index would
  // otherwise write onto a different record that happens to occupy the slot.
  const rels = read('unkeyed.yaml');
  const parsed = parseDocument(rels).toJS() as any[];

  const { text, splice } = applyEdit(rels, {
    op: 'add-block',
    target: { index: 1, match: { from: 'halbeck', to: 'zorn' } },
    field: 'review',
    entries: { by: 'test', date: '2026-07-29' }
  });
  ok(
    'index target: only the spliced region differs',
    untouchedOutside(rels, text, splice.start, splice.end, splice.text)
  );
  const after = parseDocument(text).toJS() as any[];
  ok('index target: the review lands on the intended record', after[1].review?.by === 'test');
  ok('index target: the neighbours are untouched', JSON.stringify(after[0]) === JSON.stringify(parsed[0]) && JSON.stringify(after[2]) === JSON.stringify(parsed[2]));

  throws(
    'stale index is refused',
    () =>
      applyEdit(rels, {
        op: 'add-block',
        target: { index: 1, match: { from: 'somebody-else', to: 'zorn' } },
        field: 'review',
        entries: { by: 'test', date: '2026-07-29' }
      }),
    'the file has changed under this edit'
  );
  throws(
    'index past the end is refused',
    () =>
      applyEdit(rels, {
        op: 'add-block',
        target: { index: 99999 },
        field: 'review',
        entries: { by: 'test', date: '2026-07-29' }
      }),
    'no record at index'
  );

  // The guard keys id-less records by position. Skipping them would make it
  // silently vacuous across a whole file of keyed-looking records, where a
  // misplaced edit is hardest to notice.
  const idless = '- from: a\n  v: 1\n\n- from: b\n  v: 2\n';
  let caught = '';
  try {
    assertOnlyTargetChanged(idless, '- from: a\n  v: 9\n\n- from: b\n  v: 8\n', '#0');
  } catch (e) {
    caught = (e as Error).message;
  }
  ok('guard covers records that have no id', caught.includes('altered unrelated record "#1"'), caught);
}

console.log('\n  -- inserting a field first --\n');

{
  // `id` belongs at the top of a record, as it is in every data file. A migration
  // that gives unkeyed records an id depends on this.
  const before = read('relationships.yaml');
  const parsed = parseDocument(before).toJS() as any[];
  const { text, splice } = applyEdit(before, {
    op: 'add-field',
    target: { index: 0, match: { from: parsed[0].from } },
    field: 'zz_first',
    value: 'probe',
    at: 'start'
  });

  ok(
    'at start: only the spliced region differs',
    untouchedOutside(before, text, splice.start, splice.end, splice.text)
  );
  ok('at start: adds one line', text.split('\n').length === before.split('\n').length + 1);
  ok('at start: the new field is the first key', /^- zz_first: probe$/m.test(text));
  ok(
    'at start: it lands on the dash line, not inside the previous record',
    text.indexOf('- zz_first: probe') < text.indexOf(`id: ${parsed[0].id}`)
  );

  const after = (parseDocument(text).toJS() as any[])[0];
  const { zz_first, ...rest } = after;
  ok('at start: no other field is disturbed', JSON.stringify(rest) === JSON.stringify(parsed[0]));

  // The exemption that makes this possible must not blunt the reorder check.
  const base = '- v: 1\n\n- v: 2\n\n- v: 3\n';
  const caught = (fn: () => void) => {
    try {
      fn();
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };
  // Swapping two id-less records is invisible to the ORDER check, because their
  // keys are their positions and the positions are unchanged. It is the content
  // comparison that catches it, reported as an alteration rather than a reorder.
  // Both are refusals; asserting the specific wording here would assert an
  // implementation detail rather than the property that matters.
  ok(
    'guard still catches a swap elsewhere while the target gains an id',
    caught(() => assertOnlyTargetChanged(base, '- id: x\n  v: 1\n\n- v: 3\n\n- v: 2\n', '#0')) !== ''
  );
  // A reorder of records that DO have ids is caught as a reorder.
  const keyed = '- id: a\n\n- id: b\n\n- id: c\n';
  ok(
    'guard catches a reorder of id-carrying records',
    caught(() => assertOnlyTargetChanged(keyed, '- id: a\n\n- id: c\n\n- id: b\n', 'a')).includes('reordered')
  );
  ok(
    'guard permits the target alone to gain an id',
    caught(() => assertOnlyTargetChanged(base, '- id: x\n  v: 1\n\n- v: 2\n\n- v: 3\n', '#0')) === ''
  );
}

console.log(`\n  ${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}\n`);
if (failures) process.exit(1);
