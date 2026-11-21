/**
 * atlas/rules/contract-award.ts: V4 and V5, a contract figure is never free-floating.
 *
 * A contract that carries an `award` must either name who reports the figure
 * (`attributed_to`) or cite a primary source (tier 1 or 2). V4 is the
 * requirement and V5 is the failure it names, so one check carries both ids.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

type ContractRow = {
  id?: unknown;
  award?: unknown;
  attributed_to?: unknown;
  sources?: unknown;
};

export const V4: Rule = Object.freeze({
  id: 'V4',
  covers: Object.freeze(['V5']),
  title: 'A contract award value is attributed or backed by a tier-1 or tier-2 source',
  layer: 'atlas',
  severity: 'error',
  needs: 'parsed',
  run(ctx: RuleContext): Finding[] {
    const tiers = new Map<string, number>();
    for (const source of (ctx.records.source ?? []) as unknown as { id?: unknown; tier?: unknown }[]) {
      if (typeof source.id === 'string' && typeof source.tier === 'number') tiers.set(source.id, source.tier);
    }
    const findings: Finding[] = [];
    for (const contract of (ctx.records.contract ?? []) as unknown as ContractRow[]) {
      if (!contract.award) continue;
      const cited = Array.isArray(contract.sources) ? contract.sources : [];
      const primary = cited.some((id) => typeof id === 'string' && (tiers.get(id) ?? 9) <= 2);
      const attributed = typeof contract.attributed_to === 'string' && contract.attributed_to.trim() !== '';
      if (primary || attributed) continue;
      const id = typeof contract.id === 'string' ? contract.id : '';
      findings.push({
        rule: 'V4',
        severity: 'error',
        record: { kind: 'contract', id },
        message: 'award.value must be attributed or backed by a primary source (tier ≤ 2): numbers never float free (V4/V5)'
      });
    }
    return findings;
  }
});
