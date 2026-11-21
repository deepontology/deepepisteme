/**
 * test/atlas-rules.ts: the atlas rules, each with the fixture that breaks it.
 *
 * One block per rule or family: a record the rule must accept, a record it must
 * name, and the control that differs from the failing record in exactly one
 * field. The rules also run through engine.validate in the last block, so the
 * runner and the register are exercised, not only the functions.
 *
 * The fixtures are ported from deeptunisia's pipeline fixtures, with synthetic
 * Ruritanian names.
 */

import { createEngine, type ParsedDataset, type RawDataset } from '../src/engine.ts';
import { ruritania } from '../examples/ruritania/deployment.ts';
import { NO_EXCEPTIONS } from '../src/kernel/exceptions.ts';
import { V1, V3, V4, V7, V9, V10, V11, V16, V17, V22, V31, V32, V8 } from '../src/atlas/rules/index.ts';
import type { RuleContext } from '../src/kernel/rules.ts';

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

function context(records: Record<string, unknown[]>): RuleContext {
  return {
    records: records as RuleContext['records'],
    exceptions: NO_EXCEPTIONS,
    claimKinds: new Set(),
    registries: new Set(['company-register'])
  };
}

/** The context the runner builds: records as parsed, with the resolved view beside them. */
function resolvedContext(raw: RawDataset): RuleContext {
  const parsed = engine.parse(raw);
  const resolved = engine.resolve(parsed.records);
  return {
    records: resolved.records,
    exceptions: NO_EXCEPTIONS,
    claimKinds: new Set(),
    registries: new Set(['company-register']),
    resolved: { index: resolved.index, basis: resolved.basis, intervals: resolved.intervals, cutoff: engine.time.cutoff }
  };
}

const sources = [
  { id: 's-primary', tier: 1 },
  { id: 's-institutional', tier: 2 },
  { id: 's-journalism', tier: 3 }
];

// ---------------------------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------------------------

assert('the atlas rules follow the kernel rules in the register', engine.rules.map((r) => r.id).join(',') === 'V12,V25,V27,V4,V10,V16,V17,V8,V3,V11,V1,V7,V31,V32,V22,V9');
assert('V3 is an atlas rule that errors', V3.layer === 'atlas' && V3.severity === 'error');
assert('V4 is an atlas rule that also covers V5', V4.layer === 'atlas' && V4.covers?.join(',') === 'V5');
assert(
  'V16 and V8 are resolved-stage errors, V17 a resolved-stage warning',
  V16.severity === 'error' && V8.severity === 'error' && V17.severity === 'warning' &&
    [V16, V17, V8].every((r) => r.layer === 'atlas' && r.needs === 'resolved')
);

// ---------------------------------------------------------------------------------------------
// V4/V5: a contract figure is attributed or backed by a primary source
// ---------------------------------------------------------------------------------------------

// deeptunisia: pipeline fixtures `ctr-fixture-award-floating` and `-attributed`.
{
  const award = { value: '1000000', currency: 'EUR', year: 2016 };
  const floating = { id: 'ctr-floating', award, sources: ['s-journalism'] };
  const attributed = { ...floating, id: 'ctr-attributed', attributed_to: 'A reporter quoted in the cited article' };
  const primary = { ...floating, id: 'ctr-primary', sources: ['s-journalism', 's-institutional'] };
  const noAward = { id: 'ctr-no-award', sources: ['s-journalism'] };
  const blank = { ...floating, id: 'ctr-blank', attributed_to: '   ' };
  const unknownSource = { ...floating, id: 'ctr-unknown-source', sources: ['s-missing'] };

  const run = (contracts: unknown[]) => V4.run(context({ source: sources, contract: contracts }));

  const found = run([floating]);
  assert('V4/V5: a figure with no attribution and no primary source fails once', found.length === 1, JSON.stringify(found));
  assert('V4/V5: the finding names the contract', found[0].record?.kind === 'contract' && found[0].record?.id === 'ctr-floating');
  assert('V4/V5: the finding is an error carrying the id V4', found[0].severity === 'error' && found[0].rule === 'V4');
  assert('V4/V5: the message names both validators and leaves the record to the finding', /V4\/V5/.test(found[0].message) && !found[0].message.includes('ctr-floating'));
  assert('V4/V5: the control differs from the failing record by the attribution alone', run([attributed]).length === 0);
  assert('V4/V5: a tier-2 source passes without an attribution', run([primary]).length === 0);
  assert('V4/V5: a contract with no award is not checked', run([noAward]).length === 0);
  assert('V4/V5: a blank attribution does not count', run([blank]).length === 1);
  assert('V4/V5: a source the register does not know is not primary', run([unknownSource]).length === 1);
  assert('V4/V5: only the failing contract is named among several', run([floating, attributed, primary, noAward]).map((f) => f.record?.id).join(',') === 'ctr-floating');
}

// ---------------------------------------------------------------------------------------------
// V10: the generic half of the geographic hierarchy
// ---------------------------------------------------------------------------------------------

// deeptunisia: pipeline fixtures `place-fixture-parentless`, `-offshore` (the schema's bbox check) and `-no-coordinates`.
{
  const owned = { person: [{ id: 'p-owner' }], institution: [{ id: 'i-owner' }], role: [{ id: 'r-owner' }] };
  const run = (places: unknown[]) => V10.run(context({ ...owned, place: places }));
  const good = { id: 'place-good', kind: 'port', parent: 'region-a', coordinates: [10.5, 36.8] };

  assert('V10: a parented place with coordinates passes', run([good]).length === 0);

  const parentless = run([{ ...good, id: 'place-parentless', parent: undefined }]);
  assert('V10: a port with no parent region fails once', parentless.length === 1 && parentless[0].severity === 'error', JSON.stringify(parentless));
  assert('V10: the finding names the place and carries the id V10', parentless[0].record?.kind === 'place' && parentless[0].record?.id === 'place-parentless' && parentless[0].rule === 'V10');
  assert('V10: a quarter may stand without a parent', run([{ ...good, kind: 'quarter', parent: undefined }]).length === 0);
  assert('V10: a town may stand without a parent', run([{ ...good, kind: 'town', parent: undefined }]).length === 0);

  const owner = run([{ ...good, id: 'place-owned', owner: 'nobody' }]);
  assert('V10: an owner that is no graph entity fails', owner.length === 1 && owner[0].severity === 'error' && /unknown owner "nobody"/.test(owner[0].message), JSON.stringify(owner));
  assert('V10: an owner that is a person, an institution or a role passes', ['p-owner', 'i-owner', 'r-owner'].every((o) => run([{ ...good, owner: o }]).length === 0));

  const bare = run([{ ...good, id: 'place-bare', coordinates: undefined }]);
  assert('V10: a parented place with no coordinates is a warning', bare.length === 1 && bare[0].severity === 'warning' && /no coordinates/.test(bare[0].message), JSON.stringify(bare));
  assert('V10: only the failing places are named among several', run([good, { ...good, id: 'place-parentless', parent: undefined }, { ...good, id: 'place-bare', coordinates: undefined }]).map((f) => f.record?.id).join(',') === 'place-parentless,place-bare');
}

// ---------------------------------------------------------------------------------------------
// V16: duplicate relationships on the same key with overlapping intervals
// ---------------------------------------------------------------------------------------------

// deeptunisia: pipeline fixture `rel-fixture-duplicate`, a synthetic duplicate
// of an existing family edge with an overlapping interval and no merged_into.
{
  const family = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
    id,
    from: 'iren-voss',
    to: 'elena-varn',
    type: 'family',
    subtype: 'spouse',
    start,
    description: 'A marriage recorded by the press twice over.',
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const a = family('rel-ruria-family-a', '1992');
  const b = family('rel-ruria-family-b', '1994');

  const run = (relationships: unknown[]) => V16.run(resolvedContext({ source: sources, relationship: relationships }));
  const found = run([a, b]);

  assert('V16: two edges on one key with overlapping intervals fail once', found.length === 1, JSON.stringify(found));
  assert('V16: the finding names the record authored first', found[0].record?.kind === 'relationship' && found[0].record?.id === 'rel-ruria-family-a');
  assert('V16: the finding is an error carrying the id V16', found[0].severity === 'error' && found[0].rule === 'V16');
  assert(
    'V16: the message names the duplicate and the key, and does not repeat the finding\'s own record',
    found[0].message ===
      'duplicate of rel-ruria-family-b (iren-voss|elena-varn|family|spouse) with an overlapping interval — merge one into the other (merged_into) or record the conflict (V16)',
    found[0].message
  );
  assert('V16: the control differs by the merge escape alone', run([a, { ...b, merged_into: 'rel-ruria-family-a' }]).length === 0);
  assert('V16: a different subtype is a different edge', run([a, { ...b, subtype: 'advisor' }]).length === 0);
  assert('V16: intervals that do not overlap are not duplicates', run([family('rel-ruria-early', '1992', { end: '1994' }), family('rel-ruria-late', '1996')]).length === 0);
  const toNothing = run([a, { ...b, merged_into: 'rel-ruria-nothing' }]);
  assert(
    'V16: a merged_into that names no record is its own finding',
    toNothing.length === 2 && toNothing.every((f) => f.rule === 'V16' && f.severity === 'error') &&
      toNothing.some((f) => f.record?.id === 'rel-ruria-family-b' && f.message === 'merged_into names unknown relationship "rel-ruria-nothing" (V16)'),
    JSON.stringify(toNothing)
  );

  const base: RawDataset = { source: [{ id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2024-03-10', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }] };
  const checked = engine.check({ ...base, relationship: [a, b] });
  const named = checked.findings.filter((f) => f.rule === 'V16');
  assert(
    'through check, the duplicate pair is the only finding and the run is not ok',
    !checked.ok && checked.findings.length === 1 && named.length === 1 && named[0].record?.id === 'rel-ruria-family-a',
    JSON.stringify(checked.findings.map((f) => `${f.rule} ${f.message}`))
  );
  const control = engine.check({ ...base, relationship: [a, { ...b, merged_into: 'rel-ruria-family-a' }] });
  assert('through check, the control is ok with no finding at all', control.ok && control.findings.length === 0, JSON.stringify(control.findings.map((f) => `${f.rule} ${f.message}`)));
}

// ---------------------------------------------------------------------------------------------
// V17: a rupture event not linked into the causal graph
// ---------------------------------------------------------------------------------------------

// deeptunisia: pipeline fixture `fixture-floating-rupture`, a rupture event
// linked to nothing.
{
  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    date: '2012-01-01',
    title_en: 'A floating rupture',
    category: 'political',
    rupture: true,
    summary: 'A rupture event linked to nothing, to prove the flag fires.',
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const floating = event('ev-ruria-floating-rupture');
  const linked = { ...floating, consequences: ['ev-ruria-reshuffle'] };

  const run = (events: unknown[]) => V17.run(resolvedContext({ source: sources, event: events }));
  const found = run([floating]);

  assert('V17: a rupture linked to nothing is flagged once', found.length === 1, JSON.stringify(found));
  assert('V17: the finding is a warning naming the event', found[0].severity === 'warning' && found[0].rule === 'V17' && found[0].record?.kind === 'event' && found[0].record?.id === 'ev-ruria-floating-rupture');
  assert('V17: the message is the consumer sentence, with no record in it', found[0].message === 'rupture event is not linked into the causal graph (V17)');
  assert('V17: the control differs by the one consequence link', run([linked]).length === 0);
  assert('V17: a cause link counts too', run([{ ...floating, causes: ['ev-ruria-reshuffle'] }]).length === 0);
  assert('V17: an unlinked event that is not a rupture is not flagged', run([{ ...floating, rupture: false }]).length === 0);
  assert(
    'V17: only the floating ruptures are flagged among several',
    run([floating, linked, event('ev-ruria-floating-two')]).map((f) => f.record?.id).join(',') === 'ev-ruria-floating-rupture,ev-ruria-floating-two'
  );

  const base: RawDataset = { source: [{ id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2024-03-10', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }] };
  const checked = engine.check({ ...base, event: [floating, linked] });
  const named = checked.findings.filter((f) => f.rule === 'V17');
  assert(
    'through check, the floating rupture is warned about and the run stays ok',
    checked.ok && named.length === 1 && named[0].record?.id === 'ev-ruria-floating-rupture',
    JSON.stringify(checked.findings.map((f) => `${f.rule} ${f.message}`))
  );
}

// ---------------------------------------------------------------------------------------------
// V8: a cause cannot begin after its consequence, and a causal cycle fails
// ---------------------------------------------------------------------------------------------

// deeptunisia: pipeline fixtures `fixture-temporal-consequence` with
// `fixture-temporal-cause`, and the `fixture-cycle-a`/`fixture-cycle-b` pair.
{
  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    date: '2011-01-01',
    title_en: 'A fixture event',
    category: 'political',
    summary: 'A synthetic event for the causal graph checks.',
    // An actor keeps the fixture from also being an orphan (V11): the through-check counts findings.
    actors: ['elena-varn'],
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const consequence = event('ev-ruria-consequence', { causes: ['ev-ruria-cause'] });
  const lateCause = event('ev-ruria-cause', { date: '2015-01-01' });

  const run = (events: unknown[]) => V8.run(resolvedContext({ source: sources, event: events }));
  const found = run([consequence, lateCause]);

  assert('V8: a cause that begins after its consequence ends fails once', found.length === 1, JSON.stringify(found));
  assert('V8: the finding names the consequence', found[0].record?.kind === 'event' && found[0].record?.id === 'ev-ruria-consequence');
  assert('V8: the finding is an error carrying the id V8', found[0].severity === 'error' && found[0].rule === 'V8');
  assert(
    'V8: the message names the cause and its date, and does not repeat the finding\'s own record',
    found[0].message === 'cause "ev-ruria-cause" (2015-01-01) begins after its consequence ends — reorder or record a dispute (V8)',
    found[0].message
  );
  assert('V8: the control differs by the cause\'s date alone', run([consequence, { ...lateCause, date: '2010-01-01' }]).length === 0);
  assert(
    'V8: a consequence that disputes its own dating is not failed',
    run([{ ...consequence, disputes: [{ claim: 'The dating of the event is contested.', held_by: 'The Herald' }] }, lateCause]).length === 0
  );

  // A cycle is the only violation this pair has: unknown dates, so the temporal
  // check cannot fire first.
  const cycleA = event('ev-ruria-cycle-a', { date: '?', causes: ['ev-ruria-cycle-b'] });
  const cycleB = event('ev-ruria-cycle-b', { date: '?', causes: ['ev-ruria-cycle-a'] });
  const cycles = run([cycleA, cycleB]);
  assert(
    'V8: a causal cycle fails as its own finding',
    cycles.length === 1 && cycles[0].rule === 'V8' && cycles[0].severity === 'error' &&
      /^causal cycle: ev-ruria-cycle-[ab] → ev-ruria-cycle-[ab] \(V8\)$/.test(cycles[0].message),
    JSON.stringify(cycles)
  );
  assert('V8: the cycle finding carries no record, because a cycle is not one record', cycles[0].record === undefined);
  assert('V8: the control differs by the one edge removed', run([cycleA, { ...cycleB, causes: [] }]).length === 0);
  assert('V8: an event that causes itself is not a cycle of two', run([event('ev-ruria-self', { causes: ['ev-ruria-self'] })]).length === 0);

  const base: RawDataset = { source: [{ id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2024-03-10', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }] };
  const checked = engine.check({ ...base, event: [consequence, lateCause] });
  const named = checked.findings.filter((f) => f.rule === 'V8');
  assert(
    'through check, the inverted pair is the only finding and the run is not ok',
    !checked.ok && checked.findings.length === 1 && named.length === 1 && named[0].record?.id === 'ev-ruria-consequence',
    JSON.stringify(checked.findings.map((f) => `${f.rule} ${f.message}`))
  );
  const control = engine.check({ ...base, event: [consequence, { ...lateCause, date: '2010-01-01' }] });
  assert('through check, the control is ok with no finding at all', control.ok && control.findings.length === 0, JSON.stringify(control.findings.map((f) => `${f.rule} ${f.message}`)));
}

// ---------------------------------------------------------------------------------------------
// V3: company registration numbers are valid and unique
// ---------------------------------------------------------------------------------------------

{
  const registration = { registry: 'company-register', number: 'CRN-1001', date: '1962-09-01' };
  const offshore = { id: 'co-offshore', registration: { ...registration, registry: 'offshore-registry' } };
  const known = { ...offshore, registration };

  const run = (companies: unknown[]) => V3.run(context({ company: companies }));

  const found = run([offshore]);
  assert('V3: a registry outside the deployment vocabulary fails once', found.length === 1, JSON.stringify(found));
  assert('V3: the finding names the company', found[0].record?.kind === 'company' && found[0].record?.id === 'co-offshore');
  assert('V3: the finding is an error naming the registry', found[0].severity === 'error' && found[0].message.includes('offshore-registry'));
  assert('V3: the control differs by the registry alone', run([known]).length === 0);

  const blank = { id: 'co-blank-number', registration: { ...registration, number: '   ' } };
  assert('V3: a whitespace number is not a number', run([blank]).length === 1 && run([blank])[0].message.includes('number'));
  assert('V3: the control differs by the number alone', run([{ ...blank, registration }]).length === 0);

  assert('V3: a company with no registration is not checked', run([{ id: 'co-bare', sources: [] }]).length === 0);
  assert(
    'V3: a registration that is not an object fails without throwing',
    run([{ id: 'co-string-reg', registration: 'CRN-1001' }]).length === 1
  );

  const first = { id: 'co-railways', registration };
  const again = { id: 'co-railways-again', registration: { ...registration } };
  const unique = { id: 'co-railways-again', registration: { ...registration, number: 'CRN-2002' } };
  const dup = run([first, again]);
  assert('V3: two companies on one registry number fail once, on the later record', dup.length === 1 && dup[0].record?.id === 'co-railways-again', JSON.stringify(dup));
  assert(
    'V3: the duplicate finding names the registry, the number and the first owner',
    dup[0].message.includes('company-register') && dup[0].message.includes('CRN-1001') && dup[0].message.includes('co-railways')
  );
  assert('V3: the control differs by the later record number alone', run([first, unique]).length === 0);

  // The company kind's schema refuses the same registry at parse, so engine.check
  // reports the schema finding first; a caller that validates records parsed by
  // its own schemas still gets the named rule, which is why V3 exists.
  const handBuilt: Record<string, unknown[]> = { company: [{ ...offshore, sources: [] }] };
  const foreign = engine.resolve(handBuilt as ParsedDataset);
  const belt = engine.validate(foreign, { only: ['V3'] });
  assert(
    'V3: a record a foreign schema let through is still named by the rule',
    belt.length === 1 && belt[0].rule === 'V3' && belt[0].record?.id === 'co-offshore',
    JSON.stringify(belt)
  );
}

// ---------------------------------------------------------------------------------------------
// V11: orphaned events
// ---------------------------------------------------------------------------------------------

{
  const orphan = { id: 'ev-orphan', actors: [], institutions: [], documents: [] };
  const withActor = { ...orphan, actors: ['elena-varn'] };

  const run = (events: unknown[]) => V11.run(context({ event: events }));

  const found = run([orphan]);
  assert('V11: an event with no actors, institutions, documents or disputes is orphaned', found.length === 1, JSON.stringify(found));
  assert(
    'V11: the finding names the event and warns',
    found[0].record?.kind === 'event' && found[0].record?.id === 'ev-orphan' && found[0].severity === 'warning'
  );
  assert('V11: the control differs by the actor alone', run([withActor]).length === 0);
  assert('V11: institutions alone keep the event linked', run([{ ...orphan, institutions: ['ministry-infrastructure'] }]).length === 0);
  assert('V11: documents alone keep the event linked', run([{ ...orphan, documents: ['gazette-2024-decree-11'] }]).length === 0);
  const dispute = { claim: 'The event took place elsewhere.', held_by: 'A rival account', source: 's-journalism', assessment: 'Not corroborated.' };
  assert('V11: a recorded dispute alone keeps the event linked', run([{ ...orphan, disputes: [dispute] }]).length === 0);
  assert('V11: an empty disputes list is no dispute', run([{ ...orphan, disputes: [] }]).length === 1);
  assert('V11: the dispute control differs by the dispute alone', run([orphan]).length === 1 && run([{ ...orphan, disputes: [dispute] }]).length === 0);
  assert('V11: materials do not count as documents', run([{ ...orphan, materials: ['gazette-2024-decree-11'] }]).length === 1);
  assert('V11: an event whose fields were never written is still orphaned', run([{ id: 'ev-bare' }]).length === 1);
  assert('V11: only the orphan is named among several', run([orphan, withActor]).map((f) => f.record?.id).join(',') === 'ev-orphan');
}

// ---------------------------------------------------------------------------------------------
// V1: direct ownership shares into one entity sum to 100 percent or less
// ---------------------------------------------------------------------------------------------

// deeptunisia: no pipeline fixture; the real data holds 29 direct percentage edges and none over 100.
{
  const stake = (id: string, from: string, pct: number, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    id,
    from,
    to: 'co-ruria-mill',
    type: 'ownership',
    start,
    end,
    equity: { pct, direct: true },
    description: 'A recorded stake in the mill.',
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const run = (relationships: unknown[]) => V1.run(resolvedContext({ source: sources, relationship: relationships }));
  const a = stake('own-ruria-a', 'org-a', 60, '2000', '2010');
  const b = stake('own-ruria-b', 'org-b', 50, '2005', '2008');

  const over = run([a, b]);
  assert('V1: two direct stakes that together exceed 100 fail once', over.length === 1 && over[0].severity === 'error' && over[0].rule === 'V1', JSON.stringify(over));
  assert('V1: the finding names the edge that pushes the sum past 100', over[0].record?.kind === 'relationship' && over[0].record?.id === 'own-ruria-b');
  assert('V1: the message names the entity, the sum and every stake in it', /co-ruria-mill sums to 110% on 2005-12-31/.test(over[0].message) && /own-ruria-a 60%/.test(over[0].message) && /own-ruria-b 50%/.test(over[0].message), over[0].message);

  assert('V1: the control differs by one percentage alone', run([a, stake('own-ruria-b', 'org-b', 40, '2005', '2008')]).length === 0);
  assert('V1: exactly 100 passes', run([a, stake('own-ruria-b', 'org-b', 40.0, '2005', '2008')]).length === 0);
  assert('V1: stakes that do not overlap in time pass', run([a, stake('own-ruria-b', 'org-b', 50, '2012', '2015')]).length === 0);
  assert('V1: a handover on one day is not an overlap', run([stake('own-ruria-a', 'org-a', 100, '2000', '2010-05-01'), stake('own-ruria-b', 'org-b', 100, '2010-05-01', '2015')]).length === 0);
  assert('V1: a look-through edge restates a stake already counted', run([a, stake('own-ruria-b', 'org-b', 50, '2005', '2008', { equity: { pct: 50, direct: false, beneficial: true } })]).length === 0);
  assert('V1: an edge merged into another is not a claim of its own', run([a, stake('own-ruria-b', 'org-b', 50, '2005', '2008', { merged_into: 'own-ruria-a' })]).length === 0);
  assert('V1: an edge superseded by another is not a claim of its own', run([a, stake('own-ruria-b', 'org-b', 50, '2005', '2008'), stake('own-ruria-c', 'org-b', 30, '2005', '2008', { supersedes: 'own-ruria-b' })]).length === 0);
  assert('V1: stakes into different entities are summed apart', run([a, stake('own-ruria-b', 'org-b', 50, '2005', '2008', { to: 'co-ruria-other' })]).length === 0);
  assert('V1: an edge with no percentage is not counted', run([a, stake('own-ruria-b', 'org-b', 50, '2005', '2008', { equity: undefined })]).length === 0);
  assert('V1: a family edge is not an ownership edge', run([a, stake('own-ruria-b', 'org-b', 50, '2005', '2008', { type: 'family' })]).length === 0);
  assert(
    'V1: three stakes are judged at the instant they all hold',
    run([stake('own-ruria-a', 'org-a', 40, '2000', '2010'), stake('own-ruria-b', 'org-b', 40, '2004', '2010'), stake('own-ruria-c', 'org-c', 30, '2006', '2010')]).map((f) => f.record?.id).join(',') === 'own-ruria-c'
  );
}

// ---------------------------------------------------------------------------------------------
// V7: a person on two boards at once
// ---------------------------------------------------------------------------------------------

// deeptunisia: no pipeline fixture; the real data holds 59 board edges and no person on two.
{
  const seat = (id: string, to: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    id,
    from: 'p-ruria-dar',
    to,
    type: 'board',
    start,
    end,
    description: 'A seat on a board.',
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const director = { id: 'p-ruria-dar', name_en: 'Dar Ruria', layers: ['political'], tagline: 'A director', summary: 'Sits on boards.', confidence: 'B', sources: ['s-journalism'] };
  const run = (relationships: unknown[]) =>
    V7.run(resolvedContext({ source: sources, person: [director], relationship: relationships } as RawDataset));
  const a = seat('brd-ruria-a', 'co-ruria-mill', '2000', '2010');
  const b = seat('brd-ruria-b', 'co-ruria-bank', '2005', '2012');

  const both = run([a, b]);
  assert('V7: two overlapping seats on different boards are flagged once', both.length === 1 && both[0].severity === 'warning' && both[0].rule === 'V7', JSON.stringify(both));
  assert('V7: the finding names the seat authored second', both[0].record?.kind === 'relationship' && both[0].record?.id === 'brd-ruria-b');
  assert('V7: the message names the person and both boards', /p-ruria-dar sits on the board of co-ruria-bank while on the board of co-ruria-mill \(brd-ruria-a\)/.test(both[0].message), both[0].message);

  assert('V7: the control differs by dates alone', run([a, seat('brd-ruria-b', 'co-ruria-bank', '2011', '2012')]).length === 0);
  assert('V7: a handover on one day is not an overlap', run([seat('brd-ruria-a', 'co-ruria-mill', '2000', '2010-05-01'), seat('brd-ruria-b', 'co-ruria-bank', '2010-05-01', '2012')]).length === 0);
  assert('V7: two edges into one board are one seat held twice', run([a, seat('brd-ruria-b', 'co-ruria-mill', '2005', '2012')]).length === 0);
  assert('V7: a seat merged into another is not a claim of its own', run([a, { ...b, merged_into: 'brd-ruria-a' }]).length === 0);
  assert('V7: a seat superseded by another is not a claim of its own', run([a, b, seat('brd-ruria-c', 'co-ruria-bank', '2005', '2012', { supersedes: 'brd-ruria-a' })]).length === 0);
  assert('V7: a family edge is not a seat', run([a, { ...b, type: 'family' }]).length === 0);
  assert('V7: three overlapping seats make three pairs', run([a, b, seat('brd-ruria-c', 'co-ruria-port', '2006', '2009')]).length === 3);
}

// ---------------------------------------------------------------------------------------------
// V31: no record interval begins past the research cutoff
// ---------------------------------------------------------------------------------------------

// deeptunisia: pipeline fixture `fixture-beyond-cutoff`, an event dated past the cutoff; the real data has none.
{
  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    date: '2026-01-01',
    title_en: 'A fixture event',
    category: 'political',
    summary: 'A synthetic event for the horizon check.',
    actors: ['elena-varn'],
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const edge = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    from: 'iren-voss',
    to: 'elena-varn',
    type: 'family',
    subtype: 'spouse',
    start: '2020',
    description: 'A marriage recorded by the press.',
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const run = (records: Record<string, unknown[]>) => V31.run(resolvedContext({ source: sources, ...records } as RawDataset));
  assert('V31: the cutoff is the deployment\'s own', engine.time.cutoff === Date.parse('2026-06-01'), String(engine.time.cutoff));

  const beyond = run({ event: [event('ev-ruria-future', { date: '2027-03-01' })] });
  assert('V31: an event that begins past the cutoff fails once', beyond.length === 1 && beyond[0].severity === 'error' && beyond[0].rule === 'V31', JSON.stringify(beyond));
  assert('V31: the finding names the event', beyond[0].record?.kind === 'event' && beyond[0].record?.id === 'ev-ruria-future');
  assert('V31: the message names the start and the cutoff', beyond[0].message === 'interval begins 2027-03-01, past the research cutoff 2026-06-01 (V31)', beyond[0].message);

  const endsPast = run({ event: [event('ev-ruria-long', { date_end: '2027-03-01' })] });
  assert('V31: an event that only ends past the cutoff is pulled back by resolve, not failed here', endsPast.length === 0, JSON.stringify(endsPast));

  assert('V31: the control differs by the date alone', run({ event: [event('ev-ruria-future', { date: '2026-03-01' })] }).length === 0);
  assert('V31: an event dated on the cutoff day passes', run({ event: [event('ev-ruria-today', { date: '2026-06-01' })] }).length === 0);
  assert('V31: an edge that begins past the cutoff fails', run({ relationship: [edge('rel-ruria-future', { start: '2027', end: '2028' })] }).map((f) => f.record?.kind + ':' + f.record?.id).join(',') === 'relationship:rel-ruria-future');
  assert('V31: an edge with an end past the cutoff is pulled back by resolve, not failed here', run({ relationship: [edge('rel-ruria-long', { end: '2030' })] }).length === 0);
  assert('V31: only the failing record is named among several', run({ event: [event('ev-ruria-ok'), event('ev-ruria-future', { date: '2027-03-01' })] }).map((f) => f.record?.id).join(',') === 'ev-ruria-future');
}

// ---------------------------------------------------------------------------------------------
// V32: a vacancy names a known, non-seated office and overlaps no holder or vacancy
// ---------------------------------------------------------------------------------------------

// deeptunisia: pipeline fixtures for a vacancy over a titular holder and a vacancy of an unknown role;
// the real data holds one vacancy and none breaks the rule.
{
  const role = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title_en: 'A fixture office',
    institution: 'ministry-infrastructure',
    authority: 50,
    summary: 'A synthetic office for the vacancy checks.',
    sources: ['s-journalism'],
    ...extra
  });
  const vacancy = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    id,
    role: 'role-ruria-office',
    start,
    end,
    confidence: 'B',
    reasoning: 'The report names no holder in the interval.',
    falsifiable_by: 'A gazette appointment inside the interval.',
    sources: ['s-journalism'],
    ...extra
  });
  const holder = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    id,
    role: 'role-ruria-office',
    holder: 'elena-varn',
    start,
    end,
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const run = (records: Record<string, unknown[]>) =>
    V32.run(resolvedContext({ source: sources, role: [role('role-ruria-office')], ...records } as RawDataset));
  const vac = vacancy('vac-ruria-a', '2020-01-01', '2020-12-31');

  assert('V32: a vacancy over a titular holder is named with the position', (() => {
    const found = run({ vacancy: [vac], position: [holder('pos-ruria-a', '2020-06-01', '2021-06-01')] });
    return found.length === 1 && found[0].severity === 'error' && found[0].record?.kind === 'vacancy' && found[0].record?.id === 'vac-ruria-a' &&
      found[0].message === 'overlaps titular position pos-ruria-a: the office cannot be both vacant and held (V32)';
  })());
  assert('V32: the control differs by the holder\'s dates alone', run({ vacancy: [vac], position: [holder('pos-ruria-a', '2021-02-01', '2022-01-01')] }).length === 0);
  assert('V32: a holder who leaves the day the vacancy begins is a handover, not an overlap', run({ vacancy: [vac], position: [holder('pos-ruria-a', '2018-01-01', '2020-01-01')] }).length === 0);
  assert('V32: an acting holder may sit inside the vacancy', run({ vacancy: [vac], position: [holder('pos-ruria-a', '2020-06-01', '2020-09-01', { acting: true })] }).length === 0);
  assert('V32: a holder of another office is not a contradiction', run({ vacancy: [vac], role: [role('role-ruria-office'), role('role-ruria-other')], position: [holder('pos-ruria-a', '2020-06-01', '2021-06-01', { role: 'role-ruria-other' })] }).length === 0);

  const unknown = run({ vacancy: [vacancy('vac-ruria-ghost', '2020-01-01', '2020-12-31', { role: 'role-ruria-none' })] });
  assert('V32: a vacancy of an unknown role fails and says so', unknown.length === 1 && unknown[0].message === 'unknown role "role-ruria-none" (V32)', JSON.stringify(unknown));

  const seated = run({ vacancy: [vac], role: [role('role-ruria-office', { seats: 5 })] });
  assert('V32: a vacancy of a seated role fails and says so', seated.length === 1 && seated[0].message === 'role "role-ruria-office" is a seated term, which has no single holder to be vacant (V32)', JSON.stringify(seated));

  const twice = run({ vacancy: [vac, vacancy('vac-ruria-b', '2020-06-01', '2021-03-01')] });
  assert('V32: two vacancies of one role that overlap fail once, on the record first in id order', twice.length === 1 && twice[0].record?.id === 'vac-ruria-a' && twice[0].message === 'overlaps vacancy vac-ruria-b of the same role (V32)', JSON.stringify(twice));
  assert('V32: the control differs by the second vacancy\'s dates alone', run({ vacancy: [vac, vacancy('vac-ruria-b', '2021-02-01', '2021-03-01')] }).length === 0);
}

// ---------------------------------------------------------------------------------------------
// Through the engine: parse, resolve, validate
// ---------------------------------------------------------------------------------------------

{
  const base: RawDataset = {
    source: [
      { id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2024-03-10', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }
    ],
    institution: [{ id: 'ministry-infrastructure', name_en: 'Ministry of Infrastructure', type: 'ministry', layer: 'political', confidence: 'B', sources: ['s-journalism'] }]
  };
  const contract = {
    id: 'ctr-floating',
    title_en: 'A contract with a free-floating figure',
    institution: 'ministry-infrastructure',
    kind: 'service',
    award: { value: '25000', currency: 'EUR', year: 2023 },
    status: 'signed',
    start: '2023-02-01',
    confidence: 'B',
    basis: 'reported',
    sources: ['s-journalism']
  };
  const failing = engine.check({ ...base, contract: [contract] });
  const named = failing.findings.filter((f) => f.rule === 'V4');
  assert('the fixture parses: V4 is the only finding', failing.findings.length === 1 && named.length === 1, JSON.stringify(failing.findings.map((f) => `${f.rule} ${f.message}`)));
  assert('check runs the atlas rule: the floating figure is reported and the run is not ok', !failing.ok && named.length === 1 && named[0].record?.id === 'ctr-floating', JSON.stringify(failing.findings.map((f) => `${f.rule} ${f.message}`)));
  const only = (ids: string[]) => engine.validate(engine.resolve(engine.parse({ ...base, contract: [contract] }).records), { only: ids });
  assert('validate with only V4 runs that rule alone', only(['V4']).length === 1 && only(['V4'])[0].rule === 'V4');
  assert('validate with only V5 reaches the rule that covers it', only(['V5']).length === 1);
  assert('validate with only another rule leaves the finding out', only(['V12']).length === 0);
  assert('validate with an unknown id throws', (() => { try { only(['V999']); return false; } catch (e) { return /V999/.test(String(e)); } })());
  const fixed = engine.check({ ...base, contract: [{ ...contract, id: 'ctr-attributed', attributed_to: 'A reporter quoted in the cited article' }] });
  assert('check on the control has no finding at all and is ok', fixed.ok && fixed.findings.length === 0, JSON.stringify(fixed.findings.map((f) => `${f.rule} ${f.message}`)));
}

// Through the engine again, for V3's unique half: the valid half is caught by
// the company kind's schema at parse, so the rule's own check run breaks the
// rule no schema can see, a duplicate registration number.
{
  const base: RawDataset = {
    source: [
      { id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2024-03-10', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }
    ]
  };
  const registration = { registry: 'company-register', number: 'CRN-1001', date: '1962-09-01' };
  const railways = { id: 'co-railways', legal_name_en: 'Ruritanian Railways Company', registration, sources: ['s-journalism'] };
  const again = { ...railways, id: 'co-railways-again', legal_name_en: 'Ruritanian Railways Company (a second record)' };
  const failing = engine.check({ ...base, company: [railways, again] });
  const named = failing.findings.filter((f) => f.rule === 'V3');
  assert('the duplicate parses: V3 is the only finding', failing.findings.length === 1 && named.length === 1, JSON.stringify(failing.findings.map((f) => `${f.rule} ${f.message}`)));
  assert(
    'check runs V3: the later company is named and the run is not ok',
    !failing.ok && named[0].record?.id === 'co-railways-again',
    JSON.stringify(failing.findings.map((f) => `${f.rule} ${f.message}`))
  );
  const control = engine.check({
    ...base,
    company: [railways, { ...again, registration: { ...registration, number: 'CRN-2002' } }]
  });
  assert('check on the control is ok with no finding at all', control.ok && control.findings.length === 0, JSON.stringify(control.findings.map((f) => `${f.rule} ${f.message}`)));
}

// And for V11: the warning runs through engine.check without failing it.
{
  const base: RawDataset = {
    source: [
      { id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2024-03-10', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }
    ]
  };
  const event = {
    id: 'ev-orphan',
    date: '2024-03-10',
    title_en: 'A reshuffle nobody is linked to',
    category: 'political',
    summary: 'The gazette published the decree; the record names no actor, institution or document yet.',
    confidence: 'B',
    sources: ['s-journalism']
  };
  const checked = engine.check({ ...base, event: [event] });
  const warned = checked.findings.filter((f) => f.rule === 'V11');
  assert(
    'the orphan parses: V11 is the only finding and it warns',
    checked.findings.length === 1 && warned.length === 1 && warned[0].severity === 'warning' && warned[0].record?.id === 'ev-orphan',
    JSON.stringify(checked.findings.map((f) => `${f.rule} ${f.message}`))
  );
  assert('a warning does not fail the check', checked.ok);
  const linked = engine.check({ ...base, event: [{ ...event, actors: ['elena-varn'] }] });
  assert('check on the control has no finding at all and is ok', linked.ok && linked.findings.length === 0, JSON.stringify(linked.findings.map((f) => `${f.rule} ${f.message}`)));
  const disputed = engine.check({
    ...base,
    event: [{ ...event, disputes: [{ claim: 'The decree was never published.', held_by: 'A rival account', source: 's-journalism', assessment: 'Not corroborated.' }] }]
  });
  assert('check on an event with a recorded dispute has no V11 finding', !disputed.findings.some((f) => f.rule === 'V11'), JSON.stringify(disputed.findings.map((f) => `${f.rule} ${f.message}`)));
}

// ---------------------------------------------------------------------------------------------
// V22: a clamped interval is published with its record
// ---------------------------------------------------------------------------------------------

// deeptunisia: 259 clamps on the real data, published in static/interval-trims.json.
{
  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    date: '2026-01-01',
    title_en: 'A fixture event',
    category: 'political',
    summary: 'A synthetic event for the clamp report.',
    actors: ['elena-varn'],
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const edge = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    from: 'iren-voss',
    to: 'elena-varn',
    type: 'family',
    subtype: 'spouse',
    start: '2020',
    description: 'A marriage recorded by the press.',
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const raw = (records: Record<string, unknown[]>) => ({ source: sources, ...records }) as RawDataset;
  const run = (records: Record<string, unknown[]>) => V22.run(resolvedContext(raw(records)));
  const where = (findings: ReturnType<typeof run>) => findings.map((f) => `${f.record?.kind}:${f.record?.id}`).join(',');

  const clamped = run({ event: [event('ev-ruria-long', { date_end: '2028-01-01' })] });
  assert('V22: an event whose end is past the cutoff is one warning', clamped.length === 1 && clamped[0].severity === 'warning' && clamped[0].rule === 'V22', JSON.stringify(clamped));
  assert('V22: the finding names the event', where(clamped) === 'event:ev-ruria-long');
  assert(
    'V22: the message says the end was pulled back and published as trimmed',
    clamped[0].message === 'interval envelope clamped: its end is pulled back to the research cutoff (published as trimmed) (V22)',
    clamped[0].message
  );
  assert('V22: the control ends inside the horizon and is not reported', run({ event: [event('ev-ruria-long', { date_end: '2026-03-01' })] }).length === 0);
  assert('V22: an edge with an end past the cutoff is reported', where(run({ relationship: [edge('rel-ruria-long', { end: '2030' })] })) === 'relationship:rel-ruria-long');
  assert('V22: an edge that ends inside the horizon is not', run({ relationship: [edge('rel-ruria-short', { end: '2024' })] }).length === 0);
  assert(
    'V22: only the clamped record is named among several',
    where(run({ event: [event('ev-ruria-ok'), event('ev-ruria-long', { date_end: '2028-01-01' })] })) === 'event:ev-ruria-long'
  );

  // A start whose year runs past the cutoff is pulled down with the end.
  const both = run({ relationship: [edge('rel-ruria-wide', { start: '2026', end: '2030' })] });
  assert(
    'V22: a year-precision start past the lowered end is reported with both clamps',
    both.length === 1 &&
      both[0].message ===
        'interval envelope clamped: its end is pulled back to the research cutoff (published as trimmed); its start is pulled down to its end (published as startClamped) (V22)',
    JSON.stringify(both)
  );

  // The start clamp alone, on an interval the resolver already produced.
  {
    const ctx = resolvedContext(raw({ event: [event('ev-ruria-long', { date_end: '2028-01-01' })] }));
    const iv = ctx.resolved!.intervals.get('event:ev-ruria-long')!;
    const intervals = new Map(ctx.resolved!.intervals);
    intervals.set('event:ev-ruria-long', { ...iv, trimmed: undefined, startClamped: true });
    const only = V22.run({ ...ctx, resolved: { ...ctx.resolved!, intervals } });
    assert(
      'V22: a start clamp without an end trim is reported with only its own clause',
      only.length === 1 && only[0].message === 'interval envelope clamped: its start is pulled down to its end (published as startClamped) (V22)',
      JSON.stringify(only)
    );
  }

  // The ongoing downgrade is resolve's own V22 finding; the rule does not repeat it.
  {
    const stale = raw({ relationship: [edge('rel-ruria-stale', { end: 'ongoing' })] });
    const settled = engine.resolve(engine.parse(stale).records);
    assert(
      'V22: an ongoing edge with no recent source is downgraded by resolve',
      settled.findings.filter((f) => f.rule === 'V22').map((f) => f.record?.id).join(',') === 'rel-ruria-stale',
      JSON.stringify(settled.findings)
    );
    assert('V22: the rule does not repeat the downgrade', run({ relationship: [edge('rel-ruria-stale', { end: 'ongoing' })] }).length === 0);
  }

  // A dataset with no resolved view has nothing to report.
  assert('V22: with no resolved view the rule finds nothing', V22.run(context({ event: [event('ev-ruria-long', { date_end: '2028-01-01' })] })).length === 0);

  const valid: RawDataset = { source: [{ id: 's-journalism', title: 'A news report', publisher: 'The Herald', date: '2026-05-01', url: 'https://example.invalid/herald', tier: 3, lang: 'en' }] };
  const checked = engine.check({ ...valid, event: [event('ev-ruria-long', { date_end: '2028-01-01' })] });
  assert('V22: a clamp is a warning, so the check stays ok', checked.ok && checked.findings.some((f) => f.rule === 'V22' && f.record?.id === 'ev-ruria-long'), JSON.stringify(checked.findings.map((f) => `${f.rule} ${f.message}`)));
}

// ---------------------------------------------------------------------------------------------
// V9: an influence edge is attached to a position or a documented edge
// ---------------------------------------------------------------------------------------------

// deeptunisia: the real data has no unmoored influence edge.
{
  const edge = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    from: 'iren-voss',
    to: 'elena-varn',
    type: 'influence',
    start: '2020',
    description: 'A reported channel of influence.',
    confidence: 'B',
    sources: ['s-journalism'],
    ...extra
  });
  const documented = (id: string, extra: Record<string, unknown> = {}) =>
    edge(id, { type: 'family', subtype: 'spouse', confidence: 'A', from: 'iren-voss', to: 'marco-tell', ...extra });
  const role = { id: 'role-ruria-office', title_en: 'A fixture office', institution: 'ministry-infrastructure', authority: 50, summary: 'A synthetic office.', sources: ['s-journalism'] };
  const position = (id: string, holder: string) => ({ id, role: 'role-ruria-office', holder, start: '2020', end: '2022', confidence: 'B', sources: ['s-journalism'] });
  const run = (records: Record<string, unknown[]>) => V9.run(resolvedContext({ source: sources, ...records } as RawDataset));
  const named = (findings: ReturnType<typeof run>) => findings.map((f) => `${f.record?.kind}:${f.record?.id}`).join(',');

  const bare = run({ relationship: [edge('rel-ruria-bare')] });
  assert('V9: an influence edge with nothing under it is one error', bare.length === 1 && bare[0].severity === 'error' && bare[0].rule === 'V9', JSON.stringify(bare));
  assert('V9: the finding names the relationship', named(bare) === 'relationship:rel-ruria-bare');
  assert(
    'V9: the message names the type and both endpoints',
    bare[0].message === 'influence edge iren-voss → elena-varn is unmoored — neither endpoint has a position or a documented edge (V9)',
    bare[0].message
  );

  assert('V9: an advisory edge with nothing under it is an error', run({ relationship: [edge('rel-ruria-advice', { type: 'advisory' })] })[0]?.severity === 'error');
  const reported = run({ relationship: [edge('rel-ruria-reported', { type: 'reported-influence' })] });
  assert('V9: a reported-influence edge with nothing under it is a warning, not an error', reported.length === 1 && reported[0].severity === 'warning', JSON.stringify(reported));

  assert('V9: a position held by one endpoint attaches the edge', run({ role: [role], position: [position('pos-ruria-held', 'elena-varn')], relationship: [edge('rel-ruria-bare')] }).length === 0);
  assert(
    'V9: the institution of a position attaches an edge that ends at it',
    run({ role: [role], position: [position('pos-ruria-held', 'marco-tell')], relationship: [edge('rel-ruria-inst', { to: 'ministry-infrastructure' })] }).length === 0
  );
  assert('V9: a position of some other person does not attach it', run({ role: [role], position: [position('pos-ruria-held', 'marco-tell')], relationship: [edge('rel-ruria-bare')] }).length === 1);
  assert('V9: a documented edge at one endpoint attaches the edge', run({ relationship: [documented('rel-ruria-marriage'), edge('rel-ruria-bare')] }).length === 0);
  assert(
    'V9: an edge that is only reported does not attach it',
    run({ relationship: [documented('rel-ruria-marriage', { confidence: 'B' }), edge('rel-ruria-bare')] }).length === 1
  );
  assert(
    'V9: an influence edge is never a neighbour, so two of them do not moor each other',
    named(run({ relationship: [edge('rel-ruria-one', { confidence: 'A' }), edge('rel-ruria-two', { to: 'marco-tell', confidence: 'A' })] })) === 'relationship:rel-ruria-one,relationship:rel-ruria-two'
  );
  assert(
    'V9: only the unmoored edge is named among several',
    named(run({ role: [role], position: [position('pos-ruria-held', 'elena-varn')], relationship: [edge('rel-ruria-held'), edge('rel-ruria-bare', { from: 'marco-tell', to: 'sofia-kern' })] })) === 'relationship:rel-ruria-bare'
  );
  assert('V9: with no resolved view the rule finds nothing', V9.run(context({ relationship: [edge('rel-ruria-bare')] })).length === 0);
}

console.log(`\n${passes}/${passes + failures} checks passed\n`);
if (failures) process.exit(1);
