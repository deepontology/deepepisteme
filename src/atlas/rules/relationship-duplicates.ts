/**
 * atlas/rules/relationship-duplicates.ts: V16, the same edge twice.
 *
 * Two relationship records with the same endpoints, type and subtype and
 * overlapping intervals say one thing twice, unless one of them names the
 * other as its survivor (`merged_into`, the merge escape). The pair fails on
 * the record authored first, naming the record it duplicates.
 *
 * Ported from the consumer's build script, including the `merged_into` escape
 * and the requirement that a `merged_into` ref resolves.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';
import type { ResolvedInterval } from '../../kernel/time.ts';

type RelationshipRow = {
  id?: unknown;
  from?: unknown;
  to?: unknown;
  type?: unknown;
  subtype?: unknown;
  merged_into?: unknown;
};

function idOf(record: RelationshipRow): string {
  return typeof record.id === 'string' ? record.id : '';
}

export const V16: Rule = Object.freeze({
  id: 'V16',
  title: 'Duplicate relationships on the same key with overlapping intervals fail',
  layer: 'atlas',
  severity: 'error',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const relationships = (ctx.records.relationship ?? []) as unknown as RelationshipRow[];
    const resolved = ctx.resolved;

    const ids = new Set(relationships.map(idOf).filter(Boolean));
    for (const r of relationships) {
      if (typeof r.merged_into === 'string' && !ids.has(r.merged_into)) {
        findings.push({
          rule: 'V16',
          severity: 'error',
          record: { kind: 'relationship', id: idOf(r) },
          message: `merged_into names unknown relationship "${r.merged_into}" (V16)`
        });
      }
    }

    const groups = new Map<string, RelationshipRow[]>();
    for (const r of relationships) {
      const key = `${r.from}|${r.to}|${r.type}|${typeof r.subtype === 'string' ? r.subtype : ''}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }

    const intervalOf = (id: string): ResolvedInterval | undefined =>
      resolved?.intervals.get(`relationship:${id}`);
    const cutoff = resolved?.cutoff ?? 0;

    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          if (a.merged_into === b.id || b.merged_into === a.id) continue;
          const aInterval = intervalOf(idOf(a));
          const bInterval = intervalOf(idOf(b));
          // Without a resolved span for both records the overlap cannot be
          // judged; the pair is left to the kinds that own the missing piece.
          if (!aInterval || !bInterval) continue;
          const aEnd = aInterval.endLatest ?? cutoff;
          const bEnd = bInterval.endLatest ?? cutoff;
          const overlap = aInterval.startEarliest <= bEnd && bInterval.startEarliest <= aEnd;
          if (overlap) {
            findings.push({
              rule: 'V16',
              severity: 'error',
              record: { kind: 'relationship', id: idOf(a) },
              message: `duplicate of ${idOf(b)} (${key}) with an overlapping interval — merge one into the other (merged_into) or record the conflict (V16)`
            });
          }
        }
      }
    }
    return findings;
  }
});
