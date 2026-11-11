/**
 * test/two-engines.ts — two engines in one process do not see each other.
 *
 * This is the property v0.1 could not have: its cutoff and floor were module
 * variables, so the last configureTime call decided every answer. Here each
 * Time object holds its own parameters and each engine its own deployment.
 */

import { createTime } from '../src/kernel/time.ts';
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
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const DAY = 86_400_000;
const AT = Date.UTC(2025, 5, 1);

// Two time models that differ only in the cutoff.
const later = createTime(ruritania.time);
const earlier = createTime({ ...ruritania.time, cutoff: '2024-01-01' });

const open = { start: '2022-01-01', end: 'ongoing' };

assert(
  'different cutoffs answer the same interval differently',
  later.certainlyActive(later.resolveInterval(open.start, open.end), AT) === true &&
    earlier.certainlyActive(earlier.resolveInterval(open.start, open.end), AT) === false,
  `${new Date(AT).toISOString()} is certain for one cutoff and not the other`
);

assert(
  'an open interval lasts to its own cutoff',
  later.durationYears(later.resolveInterval(open.start, open.end)) >
    earlier.durationYears(earlier.resolveInterval(open.start, open.end)) + 2,
  'duration follows the engine cutoff'
);

// Two floors, one process.
const oldFloor = createTime({ ...ruritania.time, floor: '1900-01-01' });
const newFloor = createTime({ ...ruritania.time, floor: '1956-03-20' });
assert(
  'different floors resolve an unknown edge differently',
  oldFloor.parseDateEdge('?').earliest === Date.UTC(1900, 0, 1) &&
    newFloor.parseDateEdge('?').earliest === Date.UTC(1956, 2, 20)
);

// Building the second model does not move the first.
assert(
  'the first cutoff still reads as its own after the second is built',
  later.cutoff === Date.UTC(2026, 5, 1) && earlier.cutoff === Date.UTC(2024, 0, 1),
  `${later.cutoff} / ${earlier.cutoff}`
);

// Same parameters, same answers: the model is a pure value.
const twin = createTime(ruritania.time);
assert(
  'two models from the same parameters agree',
  twin.certainlyActive(twin.resolveInterval(open.start, open.end), AT) ===
    later.certainlyActive(later.resolveInterval(open.start, open.end), AT)
);

// Two engines, one process: time.
const engineLater = createEngine(ruritania);
const engineEarlier = createEngine({
  ...ruritania,
  time: { ...ruritania.time, cutoff: '2023-01-01' }
});
const oldPost = engineLater.time.resolveInterval('2020-01-01', 'ongoing');
const oldPostEarly = engineEarlier.time.resolveInterval('2020-01-01', 'ongoing');
const MID_2023 = Date.UTC(2023, 6, 1);
assert(
  'two engines answer one interval differently',
  engineLater.time.certainlyActive(oldPost, MID_2023) === true &&
    engineEarlier.time.certainlyActive(oldPostEarly, MID_2023) === false
);
assert(
  'the later engine keeps its own cutoff',
  engineLater.time.cutoff === Date.UTC(2026, 5, 1) &&
    engineEarlier.time.cutoff === Date.UTC(2023, 0, 1)
);

// Two engines, one process: the envelope reads its own deployment's gazette.
const tribune = createEngine({
  ...ruritania,
  gazette: { vocabulary: ['tribune'], sourcePrefixes: ['tribune-'] }
});
assert(
  'each engine recognises its own gazette vocabulary',
  tribune.envelope.reviewOverclaims('tribune verified', ['s-1']) === true &&
    engineLater.envelope.reviewOverclaims('tribune verified', ['s-1']) === false
);

// The observation predicate is cutoff-bound, day after day.
const after = engineLater.time.resolveInterval('2020-01-01', '2020-12-31');
assert(
  'nothing is certain past a cutoff',
  !engineEarlier.time.certainlyActive(after, engineEarlier.time.cutoff + DAY) &&
    !engineLater.time.certainlyActive(after, engineLater.time.cutoff + DAY)
);

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
