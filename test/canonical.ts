/**
 * test/canonical.ts: the stable projection and the dataset hash.
 *
 * The hash is a fingerprint of a release, so the properties that matter are
 * which differences it must ignore (key order, the build clock, declared
 * derived fields) and which it must catch (array order, any authored field).
 *
 * The drop paths here are the shape deeptunisia uses: an array wildcard segment
 * and plain dotted paths.
 */

import { hash, project, CANONICAL_GENERATED } from '../src/kernel/canonical.ts';
import { createEngine } from '../src/engine.ts';
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

function throwsWith(fn: () => unknown, needle: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return String((e as Error).message).includes(needle);
  }
}

/** deeptunisia's three cases: two derived timelines and two payload sizes. */
const DROPS = ['people[].timeline', 'institutions[].timeline', 'meta.shippedKB', 'meta.datasetKB'];

function fixture(): Record<string, unknown> {
  return {
    meta: {
      generated: '2026-11-12T03:04:05.000Z',
      jurisdiction: 'Ruritania',
      shippedKB: 412,
      datasetKB: 233,
      datasetHash: 'not-the-real-one'
    },
    people: [
      {
        id: 'vodrik',
        name_en: 'Aleks Vodrik',
        tagline: 'Held the interior ministry through two constitutions',
        timeline: [{ from: 1956, to: 1961 }]
      },
      {
        id: 'halbeck',
        name_en: 'Mira Halbeck',
        tagline: 'A judge who outlasted three governments',
        timeline: [{ from: 1961, to: 1974 }]
      }
    ],
    institutions: [
      {
        id: 'ministry-interior',
        name_en: 'Ministry of the Interior',
        timeline: [{ from: 1949, to: 1980 }]
      }
    ]
  };
}

const base = fixture();
const baseHash = hash(base, { drop: DROPS });

// 1. Key order is not meaning: the projection sorts keys, so a rebuilt object
//    with its keys inserted in another order hashes the same.
{
  const reordered: Record<string, unknown> = {
    institutions: base.institutions,
    people: base.people,
    meta: {
      datasetKB: 233,
      datasetHash: 'not-the-real-one',
      shippedKB: 412,
      jurisdiction: 'Ruritania',
      generated: '2026-11-12T03:04:05.000Z'
    }
  };
  assert('key order does not change the hash', hash(reordered, { drop: DROPS }) === baseHash);
}

// 2. Array order is meaning: curated lists are published in their authored
//    order, so a reordered array is a different dataset.
{
  const reordered = fixture();
  reordered.people = [...(reordered.people as unknown[])].reverse();
  assert('array order changes the hash', hash(reordered, { drop: DROPS }) !== baseHash);

  const reorderedTimeline = fixture();
  (reorderedTimeline.people as Array<Record<string, unknown>>)[0].timeline = [{ from: 1961, to: 1956 }];
  assert('a dropped array is still dropped', hash(reorderedTimeline, { drop: DROPS }) === baseHash);
}

// 3. The wall clock is not meaning: meta.generated is replaced by a fixed
//    stand-in, so two builds a second apart agree.
{
  const later = fixture();
  (later.meta as Record<string, unknown>).generated = '2027-01-01T00:00:00.000Z';
  assert('the build timestamp does not change the hash', hash(later, { drop: DROPS }) === baseHash);
  assert(
    'the projection carries the fixed timestamp',
    (project(base, { drop: DROPS }) as { meta: { generated: string } }).meta.generated === CANONICAL_GENERATED
  );
}

// 4. A dropped field does not change the hash, because the release does not
//    publish it as part of the graph.
{
  const changed = fixture();
  (changed.people as Array<Record<string, unknown>>)[0].timeline = [{ from: 1900, to: 1999 }];
  (changed.institutions as Array<Record<string, unknown>>)[0].timeline = [];
  (changed.meta as Record<string, unknown>).shippedKB = 9999;
  (changed.meta as Record<string, unknown>).datasetKB = 1;
  assert('a dropped path does not change the hash', hash(changed, { drop: DROPS }) === baseHash);
}

// 5. An authored field does.
{
  const changed = fixture();
  (changed.people as Array<Record<string, unknown>>)[0].tagline = 'A different sentence entirely';
  assert('a non-dropped field changes the hash', hash(changed, { drop: DROPS }) !== baseHash);

  const unsorted = fixture();
  (unsorted.meta as Record<string, unknown>).jurisdiction = 'Elsewhere';
  assert('a non-dropped meta field changes the hash', hash(unsorted, { drop: DROPS }) !== baseHash);
}

// 6. The hash is sha256, lowercase hex, and nothing else.
{
  assert('hash is 64 lowercase hex', /^[0-9a-f]{64}$/.test(baseHash), baseHash);
  assert('two calls agree', hash(fixture(), { drop: DROPS }) === baseHash);
}

// The self-referential field: the hash must not depend on the hash it produced,
// or no build could ever reproduce it.
{
  const changed = fixture();
  (changed.meta as Record<string, unknown>).datasetHash = 'aaaaaaaaaaaaaaaa';
  assert('meta.datasetHash does not change the hash', hash(changed, { drop: DROPS }) === baseHash);
}

// The projection is a value, not a mutation.
{
  const input = fixture();
  project(input, { drop: DROPS });
  const meta = input.meta as Record<string, unknown>;
  assert('project does not touch the input', meta.generated === '2026-11-12T03:04:05.000Z' && meta.shippedKB === 412);
  assert(
    'project leaves the dropped field in the input',
    ((input.people as Array<Record<string, unknown>>)[0].timeline as unknown[]).length === 1
  );
}

// Drops a deployment does not declare are not applied: the same dataset with no
// drops keeps the timeline and the sizes, so the two hashes differ.
{
  assert('without drops the hash differs', hash(base) !== baseHash);
  const projected = project(base) as { people: Array<Record<string, unknown>>; meta: Record<string, unknown> };
  assert('without drops the timeline survives', Array.isArray(projected.people[0].timeline));
  assert('without drops the sizes survive', projected.meta.shippedKB === 412);
}

// A path that names nothing in a given dataset drops nothing, and a malformed
// path is a programming error.
{
  const short = { meta: { generated: 'x' }, people: [{ id: 'a' }] };
  assert('a path that names nothing drops nothing', hash(short, { drop: ['people[].timeline', 'meta.absent'] }) === hash(short));
  assert('an empty path is refused', throwsWith(() => hash(short, { drop: ['' as string] }), 'non-empty string'));
  assert('an empty segment is refused', throwsWith(() => hash(short, { drop: ['meta..x'] }), 'empty segment'));
  assert('an empty array name is refused', throwsWith(() => hash(short, { drop: ['[].x'] }), 'empty array name'));
}

// The engine exposes the same projection and hash. Two engines in one process
// share the kernel functions but not any state.
{
  const engine = createEngine(ruritania);
  assert('the engine projects the same bytes', JSON.stringify(engine.canonical.project(base, { drop: DROPS })) === JSON.stringify(project(base, { drop: DROPS })));
  assert('the engine hashes the same value', engine.canonical.hash(base, { drop: DROPS }) === baseHash);
  assert('canonical is frozen', Object.isFrozen(engine.canonical));
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
