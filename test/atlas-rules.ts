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
import { V3, V4 } from '../src/atlas/rules/index.ts';
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

const sources = [
  { id: 's-primary', tier: 1 },
  { id: 's-institutional', tier: 2 },
  { id: 's-journalism', tier: 3 }
];

// ---------------------------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------------------------

assert('the atlas rules follow the kernel rules in the register', engine.rules.map((r) => r.id).join(',') === 'V12,V25,V27,V3,V4');
assert('V4 is an atlas rule that also covers V5', V4.layer === 'atlas' && V4.covers?.join(',') === 'V5');
assert('V3 is an atlas rule that errors', V3.layer === 'atlas' && V3.severity === 'error');

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

console.log(`\n${passes}/${passes + failures} checks passed\n`);
if (failures) process.exit(1);
