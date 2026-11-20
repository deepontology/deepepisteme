/**
 * atlas/rules/ownership-sum.ts: V1, an owned thing cannot be more than whole.
 *
 * The direct ownership edges into one entity carry percentages (`equity.pct`).
 * At any instant at which several of them are certainly live, their sum must
 * not exceed 100. An edge that is a look-through (`equity.direct: false`, the
 * beneficial owner behind a vehicle) restates a holding another edge already
 * counts, so it is left out. An edge merged into another, or superseded by
 * one, is no longer a claim of its own and is left out too.
 *
 * "Certainly live" is the interval's own certainty: from the latest the edge
 * could have started to the earliest it could have ended (the cutoff for an
 * edge still running). Two edges whose dates only might overlap are not
 * flagged; that is a dating question, not an arithmetic one. An edge that ends
 * on the day another begins is a handover, not an overlap.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

type OwnershipRow = {
  id?: unknown;
  to?: unknown;
  type?: unknown;
  equity?: { pct?: unknown; direct?: unknown } | null;
  merged_into?: unknown;
  supersedes?: unknown;
};

const OWNERSHIP_TYPES = new Set(['ownership', 'shareholder']);
const TOLERANCE = 1e-6;

function idOf(record: OwnershipRow): string {
  return typeof record.id === 'string' ? record.id : '';
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const V1: Rule = Object.freeze({
  id: 'V1',
  title: 'Direct ownership shares into one entity sum to 100 percent or less at any instant',
  layer: 'atlas',
  severity: 'error',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const resolved = ctx.resolved;
    if (!resolved) return findings;
    const relationships = (ctx.records.relationship ?? []) as unknown as OwnershipRow[];

    const superseded = new Set<string>();
    for (const r of relationships) if (typeof r.supersedes === 'string') superseded.add(r.supersedes);

    type Edge = { id: string; pct: number; from: number; until: number };
    const byOwned = new Map<string, Edge[]>();
    for (const r of relationships) {
      if (typeof r.type !== 'string' || !OWNERSHIP_TYPES.has(r.type)) continue;
      if (typeof r.to !== 'string' || typeof r.equity?.pct !== 'number') continue;
      if (r.equity.direct === false) continue;
      if (typeof r.merged_into === 'string' || superseded.has(idOf(r))) continue;
      const interval = resolved.intervals.get(`relationship:${idOf(r)}`);
      if (!interval) continue;
      const until = interval.endEarliest ?? resolved.cutoff;
      if (interval.startLatest >= until) continue;
      const list = byOwned.get(r.to) ?? [];
      list.push({ id: idOf(r), pct: r.equity.pct, from: interval.startLatest, until });
      byOwned.set(r.to, list);
    }

    for (const [owned, edges] of byOwned) {
      if (edges.length < 2) continue;
      // The sum only grows at an edge's start, so each start is the instant to test.
      const flagged = new Set<string>();
      for (const probe of [...edges].sort((a, b) => a.from - b.from)) {
        const live = edges.filter((e) => e.from <= probe.from && probe.from < e.until);
        const sum = live.reduce((total, e) => total + e.pct, 0);
        if (sum <= 100 + TOLERANCE || flagged.has(probe.id)) continue;
        flagged.add(probe.id);
        findings.push({
          rule: 'V1',
          severity: 'error',
          record: { kind: 'relationship', id: probe.id },
          message: `direct ownership of ${owned} sums to ${Math.round(sum * 1e4) / 1e4}% on ${day(probe.from)} (${live.map((e) => `${e.id} ${e.pct}%`).join(', ')}): shares must total 100% or less — end the stake that was sold, mark a look-through as not direct, or record the conflict (V1)`
        });
      }
    }
    return findings;
  }
});
