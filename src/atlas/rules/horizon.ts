/**
 * atlas/rules/horizon.ts: V31, nothing is asserted past the research cutoff.
 *
 * Every time-based view clips records past the cutoff, so a record dated
 * beyond it renders nowhere while every other check stays green. This rule
 * compares the resolved interval of each position, relationship and event to
 * the cutoff: a start that falls after it is an error that names the record.
 *
 * Equality passes: a record dated on the cutoff day is a valid record, not a
 * future one. Only the start is checked, because `resolve` already pulls an
 * authored end past the cutoff back to it and publishes the clamp as
 * `trimmed`: nothing is ever asserted past the horizon by an end, so an end
 * check could never fire. A start cannot be pulled back without inventing a
 * date, so a start past the cutoff is the leak this rule exists to catch.
 *
 * Scope is record intervals only: a verification or a dispute dated after the
 * cutoff is a fact about the review, not about the world, and stays legal.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

const KINDS = ['position', 'relationship', 'event'] as const;

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const V31: Rule = Object.freeze({
  id: 'V31',
  title: 'No record interval begins past the research cutoff',
  layer: 'atlas',
  severity: 'error',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const resolved = ctx.resolved;
    if (!resolved) return findings;
    const cutoff = resolved.cutoff;
    for (const kind of KINDS) {
      for (const record of (ctx.records[kind] ?? []) as unknown as { id?: unknown }[]) {
        const id = typeof record.id === 'string' ? record.id : '';
        const interval = resolved.intervals.get(`${kind}:${id}`);
        if (!interval) continue;
        if (interval.startEarliest > cutoff) {
          findings.push({
            rule: 'V31',
            severity: 'error',
            record: { kind, id },
            message: `interval begins ${day(interval.startEarliest)}, past the research cutoff ${day(cutoff)} (V31)`
          });
        }
      }
    }
    return findings;
  }
});
