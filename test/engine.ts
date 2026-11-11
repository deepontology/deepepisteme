/**
 * test/engine.ts — createEngine: validation, this slice's parts, and the
 * default engine the v0.1 modules delegate to.
 *
 * The envelope checks here are the point of the slice: the exception sets are
 * passed in and may change between parses, with no configure function and no
 * module state.
 */

import { z } from 'zod';
import { createEngine, type Deployment } from '../src/engine.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';
import { legacyDeployment, legacyEngine } from '../src/legacy.ts';

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

function throwsWith(fn: () => unknown, needle: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return String((e as Error).message).includes(needle);
  }
}

const engine = createEngine(ruritania);

// The parts this slice builds.
assert('engine carries its deployment', engine.deployment.name === 'Ruritania');
assert('engine carries its time model', engine.time.cutoff === Date.UTC(2026, 5, 1));
assert('engine is frozen', Object.isFrozen(engine));

// The parts it does not build yet name their slice.
assert('parse names slice 2', throwsWith(() => engine.parse({}, { sourceExceptions: new Map(), basisOverrides: new Map() }), 'slice 2'));
assert('resolve names slice 4', throwsWith(() => engine.resolve({}), 'slice 4'));
assert('validate names slice 4', throwsWith(() => engine.validate({ records: {}, intervals: new Map(), basis: new Map(), index: new Map() }), 'slice 4'));
assert('check names slice 2 through parse', throwsWith(() => engine.check({}, { sourceExceptions: new Map(), basisOverrides: new Map() }), 'slice 2'));
assert('kinds names slice 3', throwsWith(() => engine.kinds, 'slice 3'));
assert('rules names slice 4', throwsWith(() => engine.rules, 'slice 4'));
assert('splicer names slice 1', throwsWith(() => engine.splicer, 'slice 1'));
assert('canonical names slice 1', throwsWith(() => engine.canonical, 'slice 1'));
assert('buildMatcher names slice 5', throwsWith(() => engine.buildMatcher([]), 'slice 5'));

// Deployment validation: a malformed deployment is a programming error.
{
  const v = ruritania.vocabulary;
  const withVocab = (patch: Partial<Deployment['vocabulary']>): Deployment => ({
    ...ruritania,
    vocabulary: { ...v, ...patch }
  });

  assert(
    'an empty vocabulary list is refused',
    throwsWith(() => createEngine(withVocab({ layers: [] })), 'vocabulary.layers must be a non-empty list')
  );
  assert(
    'a duplicate vocabulary entry is refused',
    throwsWith(() => createEngine(withVocab({ layers: ['political', 'political'] })), 'duplicate entry')
  );
  assert(
    'a relationship type without a direction is refused',
    throwsWith(
      () => createEngine(withVocab({ relationshipTypes: [...v.relationshipTypes, 'ghost-edge'] })),
      'no entry for relationship type "ghost-edge"'
    )
  );
  assert(
    'a direction for an unknown type is refused',
    throwsWith(
      () => createEngine(withVocab({ edgeDirection: { ...v.edgeDirection, 'ghost-edge': 'directed' } })),
      'not a relationship type'
    )
  );
  assert(
    'an unknown direction value is refused',
    throwsWith(
      () => createEngine(withVocab({ edgeDirection: { ...v.edgeDirection, appointment: 'sideways' as never } })),
      'not one of directed, symmetric, contextual'
    )
  );
  assert(
    'a time floor that is not a day is refused',
    throwsWith(
      () => createEngine({ ...ruritania, time: { ...ruritania.time, floor: '1900' } }),
      'day-precision'
    )
  );
  assert(
    'a cutoff month that does not exist is refused',
    throwsWith(
      () => createEngine({ ...ruritania, time: { ...ruritania.time, cutoff: '2026-13-01' } }),
      'Invalid month'
    )
  );
  assert(
    'a discount weight outside 0 to 1 is refused',
    throwsWith(
      () =>
        createEngine({
          ...ruritania,
          index: { discount: { ...ruritania.index.discount, reported: 2 } }
        }),
      'between 0 and 1'
    )
  );
  assert(
    'a one-character name is refused',
    throwsWith(() => createEngine({ ...ruritania, name: 'R' }), 'at least 2 non-blank characters')
  );
  assert('the example deployment itself is accepted', !!createEngine(ruritania).time);
}

// The envelope: exception sets arrive per schema and may change between parses.
{
  const { envelope } = engine;
  const base = z.strictObject({
    id: envelope.slug,
    sources: z.array(envelope.slug).default([]),
    confidence: envelope.Confidence.default('B'),
    verification: envelope.Verification.default('verified'),
    basis: envelope.Basis.optional()
  });

  const closed = envelope.withClaimEnvelope('position', base);
  assert('empty sources are refused for a required kind', !closed.safeParse({ id: 'p-1' }).success);

  const open = envelope.withClaimEnvelope('position', base, {
    emptySources: new Set(['position:p-1'])
  });
  assert('a passed-in exception allows the same record', open.safeParse({ id: 'p-1' }).success);
  assert('the exception is keyed by record, not by kind', !open.safeParse({ id: 'p-2' }).success);

  const holder: { current: { emptySources?: ReadonlySet<string> } } = { current: {} };
  const watched = envelope.withClaimEnvelope('position', base, () => holder.current);
  assert('a live exception set starts closed', !watched.safeParse({ id: 'p-3' }).success);
  holder.current = { emptySources: new Set(['position:p-3']) };
  assert('replacing the set while parsing is honoured', watched.safeParse({ id: 'p-3' }).success);
  holder.current = { emptySources: new Set() };
  assert('removing it closes the record again', !watched.safeParse({ id: 'p-3' }).success);

  const override = { id: 'p-4', confidence: 'B', sources: ['s-1'], basis: 'documented' };
  assert('an unregistered basis override is refused', !closed.safeParse(override).success);
  const registered = envelope.withClaimEnvelope('position', base, {
    basisOverrides: new Set(['position:p-4:reported>documented'])
  });
  assert('a registered basis override parses', registered.safeParse(override).success);

  assert(
    'deriveBasis and isBasisUpgrade are on the engine',
    envelope.deriveBasis('C', 'needs-primary-source') === 'inferred' &&
      envelope.isBasisUpgrade('documented', 'reported')
  );
}

// The default engine the v0.1 modules delegate to is the Ruritania deployment
// in everything those modules read.
{
  const fields = ['name', 'time', 'gazette', 'registry', 'bbox', 'index', 'vocabulary'] as const;
  for (const field of fields) {
    const a = JSON.stringify(legacyDeployment[field]);
    const b = JSON.stringify(ruritania[field]);
    assert(`legacy deployment agrees with Ruritania on ${field}`, a === b, `${a} / ${b}`);
  }
  assert(
    'the legacy engine answers with the Ruritania cutoff',
    legacyEngine.time.cutoff === createEngine(ruritania).time.cutoff
  );
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
