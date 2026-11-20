/**
 * test/engine.ts: createEngine: validation, this slice's parts, and the
 * default engine the v0.1 modules delegate to.
 *
 * The envelope checks here are the point of the slice: the exception sets are
 * passed in and may change between parses, with no configure function and no
 * module state.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createEngine, type Deployment, type RawDataset } from '../src/engine.ts';
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

const engine = createEngine(ruritania);

// The parts this slice builds.
assert('engine carries its deployment', engine.deployment.name === 'Ruritania');
assert('engine carries its time model', engine.time.cutoff === Date.UTC(2026, 5, 1));
assert('engine is frozen', Object.isFrozen(engine));

// The three stages are built.
assert('parse is built', engine.parse({}, undefined).findings.length === 0);
{
  const resolved = engine.resolve(engine.parse({}, undefined).records);
  assert('resolve of an empty dataset is empty', resolved.index.size === 0 && resolved.basis.size === 0);
  assert('validate of an empty dataset finds nothing', engine.validate(resolved).length === 0);
  const checked = engine.check({}, undefined);
  assert('check of an empty dataset is ok and carries the resolved dataset', checked.ok && checked.findings.length === 0 && !!checked.resolved);
}
assert('kinds is built', engine.kinds.size === 21);
assert('rules is built', engine.rules.map((r) => r.id).join(',') === 'V12,V25,V27,V4,V10,V16,V17,V8,V3,V11,V1,V7,V31,V32,V22,V9');

// resolve: the interval of every dated record kind, settled the way the
// consumer's build settles it before emitting.
{
  const raw: RawDataset = {
    source: [
      { id: 's-recent', title: 'A recent dispatch', publisher: 'The Herald', date: '2026-05-01', url: 'https://example.invalid/recent', tier: 3 },
      { id: 's-stale', title: 'A stale dispatch', publisher: 'The Herald', date: '2024-03-10', url: 'https://example.invalid/stale', tier: 3 }
    ],
    position: [
      { id: 'pos-confirmed', role: 'role-infra-minister', holder: 'elena-varn', start: '2022-03-15', end: 'ongoing', sources: ['s-recent'] },
      { id: 'pos-stale', role: 'role-infra-deputy', holder: 'marco-tell', start: '2022-03-15', end: 'ongoing', sources: ['s-stale'] },
      { id: 'pos-inverted', role: 'role-union-leader', holder: 'sofia-kern', start: '2024-03-10', end: '2024-03-01', sources: ['s-recent'] },
      {
        id: 'pos-disputed',
        role: 'role-union-leader',
        holder: 'sofia-kern',
        start: '2024-03-10',
        end: '2024-03-01',
        disputes: [{ claim: 'The end date is the deposition, not the appointment.', held_by: 'The Herald' }],
        sources: ['s-recent']
      }
    ],
    relationship: [{ id: 'rel-alliance', from: 'sofia-kern', to: 'elena-varn', type: 'political-alliance', description: 'The Union Party endorsed the programme.', confidence: 'B', start: '2023', sources: ['s-recent'] }],
    event: [{ id: 'ev-reshuffle', date: '2024-03-10', title_en: 'A cabinet reshuffle', category: 'political', summary: 'The portfolio moved hands.', confidence: 'B', sources: ['s-recent'] }],
    era: [
      { id: 'era-coalition', label_en: 'Coalition Era', start: '2004-06-01', end: '2026-06-01', thesis: 'Coalitions concentrated contracting authority in few hands.', accent: '#805ad5', sources: ['s-recent'] },
      { id: 'era-overrun', label_en: 'Overrun Era', start: '2004-06-01', end: '~2026-06', thesis: 'An era whose authored end runs past the cutoff.', accent: '#2b6cb0', sources: ['s-recent'] }
    ],
    role: [{ id: 'role-infra-undersecretary', title_en: 'An undersecretary of infrastructure', institution: 'ministry-infrastructure', authority: 40, summary: 'An office with no titular holder in the fixture.', sources: ['s-recent'] }],
    contract: [{ id: 'ctr-concession', title_en: 'A transport concession', institution: 'ministry-infrastructure', kind: 'concession', status: 'signed', start: '2024-02-01', confidence: 'B', sources: ['s-recent'] }],
    vacancy: [{ id: 'vac-deputy', role: 'role-infra-undersecretary', start: '2024-03-10', end: '2024-09-01', confidence: 'B', reasoning: 'The account names no holder in the interval.', falsifiable_by: 'An appointment decree would refute it.', sources: ['s-recent'] }],
    education: [{ id: 'edu-varn', person: 'elena-varn', institution: null, degree_en: 'A licence in civil engineering', field: 'engineering', kind: 'licence', start: '1998', end: '2002', sources: ['s-recent'] }],
    institution: [{ id: 'inst-midland', name_en: 'Midland University', type: 'university', layer: 'civil', parent: null, active: { start: '1962-09-01', end: 'ongoing' }, order: 30, summary: 'A public university.', confidence: 'B', sources: ['s-stale'] }],
    licence: [{ id: 'lic-spectrum', holder: 'ruritania-railways', issuer: 'ministry-infrastructure', kind: 'spectrum', grant: '2020-07-01', sources: ['s-recent'] }]
  };

  const parsed = engine.parse(raw);
  assert(
    'the interval fixture parses clean',
    parsed.findings.length === 0,
    JSON.stringify(parsed.findings.map((f) => f.message))
  );
  const resolved = engine.resolve(parsed.records);
  const iv = (key: string) => resolved.intervals.get(key);

  assert(
    'every dated record is resolved, keyed kind:id',
    resolved.intervals.size === 13,
    `intervals: ${[...resolved.intervals.keys()].join(', ')}`
  );
  assert(
    'the dated kinds are all present by their ids',
    ['pos-confirmed', 'pos-stale', 'pos-inverted', 'pos-disputed'].every((id) => iv(`position:${id}`) !== undefined) &&
      !!iv('relationship:rel-alliance') && !!iv('event:ev-reshuffle') && !!iv('era:era-coalition') && !!iv('era:era-overrun') &&
      !!iv('contract:ctr-concession') && !!iv('vacancy:vac-deputy') && !!iv('education:edu-varn') &&
      !!iv('institution:inst-midland') && !!iv('licence:lic-spectrum')
  );
  assert(
    'the id index and the derived basis are unchanged',
    resolved.index.size === 16 && resolved.basis.size === 11,
    `index ${resolved.index.size}, basis ${resolved.basis.size}`
  );

  // Settling `ongoing` against the evidence.
  assert('an ongoing interval with a recent dated source stays ongoing', iv('position:pos-confirmed')?.status === 'ongoing');
  assert(
    'an ongoing interval with no recent observation is downgraded, with a V22 warning',
    iv('position:pos-stale')?.status === 'last-verified' &&
      resolved.findings.some((f) => f.rule === 'V22' && f.severity === 'warning' && f.record?.id === 'pos-stale')
  );
  assert(
    'the downgrade warning carries the consumer sentence',
    resolved.findings.find((f) => f.record?.id === 'pos-stale')?.message ===
      'ongoing with no source dated within 90 days of the cutoff — downgraded to last-verified'
  );
  assert(
    'an institution settles ongoing from its active object and its sources',
    iv('institution:inst-midland')?.status === 'last-verified' &&
      resolved.findings.some((f) => f.rule === 'V22' && f.record?.id === 'inst-midland')
  );

  // The cutoff contract.
  assert(
    'a dated end past the cutoff is clamped back and marked trimmed',
    iv('era:era-overrun')?.endLatest === engine.time.cutoff && iv('era:era-overrun')?.trimmed === true,
    JSON.stringify(iv('era:era-overrun'))
  );
  assert(
    'the clamp keeps the authored token in raw',
    iv('era:era-overrun')?.raw.end === '~2026-06'
  );
  assert(
    'a licence anchors its grant and is neither settled nor clamped',
    iv('licence:lic-spectrum')?.status === 'unknown' &&
      iv('licence:lic-spectrum')?.endLatest === engine.time.cutoff &&
      iv('licence:lic-spectrum')?.trimmed === undefined
  );

  // An interval that cannot resolve is a finding, never a thrown error.
  const inverted = resolved.findings.filter((f) => f.rule === 'V15');
  assert(
    'an interval that ends before it begins is a V15 error naming the record',
    inverted.length === 1 && inverted[0].severity === 'error' && inverted[0].record?.kind === 'position' && inverted[0].record?.id === 'pos-inverted',
    JSON.stringify(inverted)
  );
  assert(
    'the V15 message is the resolver sentence about the tokens',
    inverted[0].message === 'Interval ends before it begins: start="2024-03-10" end="2024-03-01"'
  );
  assert(
    'a record that disputes its own span keeps its envelope instead of failing',
    iv('position:pos-disputed')?.startLatest === Date.UTC(2024, 2, 10) &&
      iv('position:pos-disputed')?.endEarliest === Date.UTC(2024, 2, 1) &&
      iv('position:pos-disputed')?.trimmed === undefined &&
      !resolved.findings.some((f) => f.record?.id === 'pos-disputed'),
    JSON.stringify(iv('position:pos-disputed'))
  );
  assert(
    'the failed record keeps its place with the unknown interval as its span',
    iv('position:pos-inverted')?.status === 'unknown'
  );

  // check() carries what resolve found.
  {
    const checked = engine.check(raw);
    assert('check fails on the V15 error and reports it', !checked.ok && checked.findings.some((f) => f.rule === 'V15'));
    assert('check also reports the resolve warnings', checked.findings.some((f) => f.rule === 'V22' && f.record?.id === 'pos-stale'));
    const clean = engine.check({ ...raw, position: raw.position!.filter((p) => (p as { id: string }).id !== 'pos-inverted') });
    assert('the same data minus the broken record is ok with only warnings left', clean.ok && clean.findings.every((f) => f.severity === 'warning'), JSON.stringify(clean.findings.map((f) => f.rule)));
  }
}
assert('splicer is built', typeof engine.splicer.applyEdit === 'function');
assert('canonical is built', typeof engine.canonical.hash === 'function');
assert(
  'match is built from the deployment word lists',
  typeof engine.match === 'function' &&
    engine
      .match([{ id: 'marco-tell', kind: 'person', names: ['Marco Tell'] }])
      .find('Marco Tell').length === 1
);
assert(
  'a duplicate matcher word list entry is refused',
  throwsWith(
    () => createEngine({ ...ruritania, matcher: { ...ruritania.matcher, surnameHeads: ['ben', 'ben'] } }),
    'matcher.surnameHeads has a duplicate entry'
  )
);

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
  assert(
    'a deployment may not shadow a kernel kind',
    throwsWith(
      () =>
        createEngine({
          ...ruritania,
          extraKinds: [
            { kind: 'source', file: 'sources.yaml', schema: z.strictObject({ id: z.string() }), bearsClaims: false, layer: 'deployment' }
          ]
        }),
      'which is a kernel kind'
    )
  );
  assert(
    'a claim kind must be a plain object schema',
    throwsWith(
      () =>
        createEngine({
          ...ruritania,
          extraKinds: [
            {
              kind: 'position',
              file: 'positions.yaml',
              schema: z.array(z.strictObject({ id: z.string() })),
              bearsClaims: true,
              layer: 'deployment'
            }
          ]
        }),
      'needs an object schema'
    )
  );
  assert(
    'the source languages must include the source default',
    throwsWith(
      () => createEngine({ ...ruritania, sourceLanguages: ['ar', 'fr'] }),
      'must include "en"'
    )
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

// The envelope's message texts: a consumer with a published exception file and
// a paper's rule numbering passes both and gets its exact strings back, while
// the defaults name a register and no rule.
{
  const env = engine.envelope;
  const base = z.strictObject({
    id: env.slug,
    sources: z.array(env.slug).default([]),
    confidence: env.Confidence.default('B'),
    basis: env.Basis.optional(),
    reasoning: z.string().optional(),
    basis_override_reason: z.string().optional()
  });

  const neutral = env.withClaimEnvelope('position', base);
  const noSource = neutral.safeParse({ id: 'p-text-1' });
  assert(
    'the neutral source sentence names a register, not a file',
    !noSource.success &&
      noSource.error.issues[0].message ===
        'rule 2: every claim record must cite at least one source, or be listed in the exception register with an owner and a deadline',
    noSource.success ? 'parsed' : noSource.error.issues[0].message
  );
  const bare = neutral.safeParse({ id: 'p-text-2', sources: ['s-1'], confidence: 'B', basis: 'documented' });
  assert(
    'the neutral override sentence carries no rule id',
    !bare.success &&
      bare.error.issues[0].message ===
        'authored basis "documented" over grade-implied "reported": a basis override requires a review object with a date and method',
    bare.success ? 'parsed' : bare.error.issues[0].message
  );

  const published = env.withClaimEnvelope('position', base, undefined, {
    exceptionFile: 'data/source-exceptions.yaml',
    basisOverrideRule: 'V27'
  });
  const handover = published.safeParse({ id: 'p-text-3' });
  assert(
    'the consumer source sentence is reproduced',
    !handover.success &&
      handover.error.issues[0].message ===
        'rule 2: every claim record must cite at least one source, or be listed in data/source-exceptions.yaml with an owner and a deadline',
    handover.success ? 'parsed' : handover.error.issues[0].message
  );
  const consumerBare = published.safeParse({ id: 'p-text-4', sources: ['s-1'], confidence: 'B', basis: 'documented' });
  assert(
    'the consumer override sentence is reproduced',
    !consumerBare.success &&
      consumerBare.error.issues[0].message ===
        'authored basis "documented" over grade-implied "reported" (V27): a basis override requires a review object with a date and method',
    consumerBare.success ? 'parsed' : consumerBare.error.issues[0].message
  );
  assert(
    'the consumer override-reason sentence is reproduced',
    !consumerBare.success &&
      consumerBare.error.issues.some(
        (i) =>
          i.message ===
          'authored basis "documented" over grade-implied "reported" (V27): a basis override requires basis_override_reason of at least 10 non-blank characters, or a live entry in data/source-exceptions.yaml'
      )
  );
}

// The review schema is the deployment's: a reviewer is a role label or a
// numbered outsider, a date is a real day, and the object is strict.
{
  const review = engine.envelope.ReviewSchema;
  const good = { date: '2026-09-10', method: 'source-check' as const };
  assert('maintainer signs a review', review.safeParse({ by: 'maintainer', ...good }).success);
  assert('a deployment pass signs a review', review.safeParse({ by: 'Gazette verification pass', ...good }).success);
  assert('a numbered outsider signs a review', review.safeParse({ by: 'reviewer-12', ...good }).success);

  const named = review.safeParse({ by: 'Jane Doe', ...good });
  assert(
    'a personal name is refused as a reviewer',
    !named.success && named.error.issues[0].message.includes('role label'),
    named.success ? 'parsed' : JSON.stringify(named.error.issues)
  );
  assert('a padded label is refused', !review.safeParse({ by: 'maintainer ', ...good }).success);
  assert('a numbered label takes digits only', !review.safeParse({ by: 'reviewer-one', ...good }).success);

  const dated = createEngine({
    ...ruritania,
    reviewerLabels: ['Initial compilation', 'JORT verification pass', 'Research pass YYYY-MM-DD']
  }).envelope.ReviewSchema;
  const refused = dated.safeParse({ by: 'Jane Doe', ...good });
  assert(
    'the refusal sentence lists the deployment labels verbatim',
    !refused.success &&
      refused.error.issues[0].message ===
        'reviewer must be a role label: maintainer, Initial compilation, JORT verification pass, Research pass YYYY-MM-DD, or reviewer-N (V23)',
    refused.success ? 'parsed' : refused.error.issues[0].message
  );
  assert('a dated pass signs a review', dated.safeParse({ by: 'Research pass 2026-10-09', ...good }).success);
  assert('a dated pass takes a full ISO day', !dated.safeParse({ by: 'Research pass 2026-10-9', ...good }).success);

  const shape = { by: 'maintainer', date: '2026-09-10', method: 'source-check' as const };
  assert('a review names a human actor', review.safeParse({ ...shape, actor: 'human' }).success);
  assert('a review names an agent actor', review.safeParse({ ...shape, actor: 'agent' }).success);
  const robot = review.safeParse({ ...shape, actor: 'robot' });
  assert(
    'an unknown actor is refused',
    !robot.success && robot.error.issues.some((i) => i.message.includes('expected one of'))
  );
  const impossible = review.safeParse({ by: 'maintainer', date: '2026-02-31', method: 'source-check' });
  assert(
    'a review date must be a real day',
    !impossible.success && impossible.error.issues.some((i) => i.message.includes('calendar-valid'))
  );
  const slashDate = review.safeParse({ by: 'maintainer', date: '26/07/2026', method: 'source-check' });
  assert(
    'a review date must be ISO',
    !slashDate.success && slashDate.error.issues.some((i) => i.message.includes('ISO date'))
  );
  const extraKey = review.safeParse({ ...shape, outcome: 'refuted' });
  assert(
    'an unknown review key is refused',
    !extraKey.success && extraKey.error.issues.some((i) => i.message.includes('Unrecognized key'))
  );
}

// A review note may not claim a gazette verification without a gazette source;
// the vocabulary and the prefixes are this engine's deployment.
{
  const over = engine.envelope.reviewOverclaims;
  assert(
    'a gazette claim without a gazette source overclaims',
    over('checked directly against the JORT decree text', ['tier3-article']) === true
  );
  assert(
    'a cited gazette source answers the claim',
    over('checked directly against the JORT decree text', ['jort-2020-123']) === false
  );
  assert(
    'the gazette match is case-insensitive',
    over('CHECKED against the GAZETTE bulletin', ['tier3-article']) === true
  );
  assert(
    'an honest disclaimer is not a claim',
    over('NOT verified against a JORT decree — corroborated in the press only', []) === false
  );
  assert(
    'a method with no gazette word never claims',
    over('reviewed the press coverage of the handover', ['tier3-article']) === false
  );
  assert('an undefined method is never a claim', over(undefined, []) === false);
}

// The default engine the v0.1 modules delegate to is the Ruritania deployment
// in everything those modules read.
{
  const fields = ['name', 'time', 'gazette', 'registry', 'bbox', 'index', 'vocabulary', 'matcher'] as const;
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

// schemaOf: the schema parse() reads a kind with, for a caller that parses one
// record at a time.
{
  const good = { id: 'pos-ok', role: 'role-infra-minister', holder: 'elena-varn', start: '2022-03-15', end: 'ongoing', sources: ['s-1'] };
  const unsourced = { id: 'alma-ruric', name_en: 'Alma Ruric', layers: ['political'], confidence: 'B', sources: [] };
  const live = {
    sourceExceptions: new Map([['person:alma-ruric', { rule: 'no-source', expires: '2026-12-01', reason: 'source in progress' }]]),
    basisOverrides: new Map()
  };
  const position = engine.schemaOf('position');
  const person = engine.schemaOf('person');
  const viaParse = (record: object, register?: typeof live, kind = 'position') => (engine.parse({ [kind]: [record] }, register).records[kind] ?? []).length === 1;

  assert('schemaOf accepts what parse accepts', position.safeParse(good).success === viaParse(good) && viaParse(good));
  assert('schemaOf rejects what parse rejects', !person.safeParse(unsourced).success && !viaParse(unsourced, undefined, 'person'));
  assert(
    'schemaOf closes a claim kind over the register it is given',
    engine.schemaOf('person', live).safeParse(unsourced).success && viaParse(unsourced, live, 'person')
  );
  assert('a register given to one schemaOf call does not reach the next', !engine.schemaOf('person').safeParse(unsourced).success);
  assert(
    'schemaOf of a kind with no envelope is its plain schema',
    engine.schemaOf('role').safeParse({ id: 'role-x', title_en: 'A role', institution: 'ministry-infrastructure', authority: 10, summary: 'A plain role.', sources: ['s-1'] }).success
  );
  assert('schemaOf of an unknown kind throws', throwsWith(() => engine.schemaOf('nonsense'), 'no kind "nonsense"'));
}

// The ./atlas export: the kind schema factories, for a consumer that wants the record types.
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, string> };
  assert('package.json exports ./atlas', pkg.exports['./atlas'] === './src/atlas/index.ts');
  const atlas = await import('../src/atlas/index.ts');
  const factories = Object.keys(atlas).filter((name) => /Schema$/.test(name) && name !== 'relationshipRefines');
  assert('./atlas exports the seventeen kind factories', factories.length === 17, factories.join(', '));
  assert('./atlas exports createAtlasKinds', typeof atlas.createAtlasKinds === 'function');
  assert('every ./atlas kind factory is a function', factories.every((name) => typeof (atlas as Record<string, unknown>)[name] === 'function'));
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
if (failures) process.exit(1);
