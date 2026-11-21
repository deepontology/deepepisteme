/**
 * atlas/rules/board-overlap.ts: V7, one person on two boards at once.
 *
 * A person on two board edges into different entities, over a stretch in which
 * both are certainly live, is a possible conflict of interest. It is flagged
 * for the reviewer, never failed: sitting on two boards is lawful and often
 * the point of the map. The finding names the edge authored second and the
 * edge it overlaps.
 *
 * "Certainly live" is the interval's own certainty: from the latest the edge
 * could have started to the earliest it could have ended (the cutoff for an
 * edge still running); an edge that ends on the day another begins is a
 * handover, not an overlap. Edges into the same entity are one seat held twice, not
 * two boards, and an edge merged into another or superseded by one is not a
 * claim of its own.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

type BoardRow = {
  id?: unknown;
  from?: unknown;
  to?: unknown;
  type?: unknown;
  merged_into?: unknown;
  supersedes?: unknown;
};

function idOf(record: BoardRow): string {
  return typeof record.id === 'string' ? record.id : '';
}

export const V7: Rule = Object.freeze({
  id: 'V7',
  title: 'A person on two board edges into different entities over the same period is flagged',
  layer: 'atlas',
  severity: 'warning',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const resolved = ctx.resolved;
    if (!resolved) return findings;
    const relationships = (ctx.records.relationship ?? []) as unknown as BoardRow[];

    const superseded = new Set<string>();
    for (const r of relationships) if (typeof r.supersedes === 'string') superseded.add(r.supersedes);
    const people = new Set((ctx.records.person ?? []).map((p) => (p as { id?: unknown }).id));

    type Seat = { id: string; to: string; from: number; until: number };
    const byPerson = new Map<string, Seat[]>();
    for (const r of relationships) {
      if (r.type !== 'board' || typeof r.from !== 'string' || typeof r.to !== 'string') continue;
      if (!people.has(r.from)) continue;
      if (typeof r.merged_into === 'string' || superseded.has(idOf(r))) continue;
      const interval = resolved.intervals.get(`relationship:${idOf(r)}`);
      if (!interval) continue;
      const until = interval.endEarliest ?? resolved.cutoff;
      if (interval.startLatest >= until) continue;
      const list = byPerson.get(r.from) ?? [];
      list.push({ id: idOf(r), to: r.to, from: interval.startLatest, until });
      byPerson.set(r.from, list);
    }

    for (const [person, seats] of byPerson) {
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          const a = seats[i];
          const b = seats[j];
          if (a.to === b.to) continue;
          if (a.from < b.until && b.from < a.until) {
            findings.push({
              rule: 'V7',
              severity: 'warning',
              record: { kind: 'relationship', id: b.id },
              message: `${person} sits on the board of ${b.to} while on the board of ${a.to} (${a.id}) over an overlapping period: a possible conflict of interest — review it, or record why it stands (V7)`
            });
          }
        }
      }
    }
    return findings;
  }
});
