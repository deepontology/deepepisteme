/**
 * atlas/rules/company-registration.ts: V3, a corporate registration is valid
 * and unique.
 *
 * Valid: the registration names one of the deployment's registries, and its
 * number is a non-blank string. The company kind's schema checks the registry
 * at parse, so within engine.check a bad registry is caught before this rule
 * runs; the rule reads the same predicate anyway, because a caller may hand
 * validate() records parsed by its own schemas, and there the finding must
 * still carry the id V3 (V12 does the same for the envelope's source check).
 *
 * Unique: no two companies carry the same registry and number. The finding
 * lands on the later record and names the earlier one, so the pair can be
 * found without a search.
 */

import { nonBlank } from '../../kernel/envelope.ts';
import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

type CompanyRow = {
  id?: unknown;
  registration?: unknown;
};

export const V3: Rule = Object.freeze({
  id: 'V3',
  title: 'Company registration numbers are valid and unique',
  layer: 'atlas',
  severity: 'error',
  needs: 'parsed',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const seen = new Map<string, string>();
    for (const company of (ctx.records.company ?? []) as unknown as CompanyRow[]) {
      const id = typeof company.id === 'string' ? company.id : '';
      const record = { kind: 'company', id };
      if (company.registration === undefined || company.registration === null) continue;

      if (typeof company.registration !== 'object') {
        findings.push({
          rule: 'V3',
          severity: 'error',
          record,
          message: 'registration must be an object with a registry, a number and a date (V3)'
        });
        continue;
      }
      const registration = company.registration as { registry?: unknown; number?: unknown };
      const registry = typeof registration.registry === 'string' ? registration.registry : '';
      const number = typeof registration.number === 'string' ? registration.number : '';

      if (!ctx.registries.has(registry)) {
        findings.push({
          rule: 'V3',
          severity: 'error',
          record,
          message: `registration.registry "${registry}" is not one of the deployment's registries (V3)`
        });
      }
      if (!nonBlank(number)) {
        findings.push({
          rule: 'V3',
          severity: 'error',
          record,
          message: 'registration.number must be a non-blank string, not whitespace (V3)'
        });
      }

      if (ctx.registries.has(registry) && nonBlank(number)) {
        const first = seen.get(`${registry}/${number}`);
        if (first !== undefined) {
          findings.push({
            rule: 'V3',
            severity: 'error',
            record,
            message: `registration ${registry} "${number}" is already carried by company ${first} (V3)`
          });
        } else {
          seen.set(`${registry}/${number}`, id);
        }
      }
    }
    return findings;
  }
});
