/**
 * atlas/rules/unmoored-influence.ts: V9, an influence edge with nothing under it.
 *
 * An influence-family edge (influence, reported-influence, advisory) must be
 * attached to something: at least one endpoint holds a position, or carries a
 * documented edge of another kind. An influence edge between two nodes that
 * nothing else connects is a bare assertion, "X influences Y" with no
 * evidenced route.
 *
 * "Holds a position" includes the institution of a position's role: a party
 * with a leader recorded, a station with a director. That record is the
 * evidenced route the edge must not float without. A neighbour counts only
 * through an edge whose derived basis is `documented`, and an influence edge
 * is never a neighbour, so two unmoored influence edges do not moor each other.
 *
 * An influence or advisory edge asserts standing, so it is an error. A
 * reported-influence edge asserts only that sources report the chain: it is
 * kept and flagged, a warning, because the popular account is what the map
 * has to show whether or not it is anchored.
 *
 * Ported from the consumer's build script with its messages.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

const INFLUENCE_TYPES = new Set(['influence', 'reported-influence', 'advisory']);

type Row = { id?: unknown; role?: unknown; holder?: unknown; institution?: unknown; type?: unknown; from?: unknown; to?: unknown };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const V9: Rule = Object.freeze({
  id: 'V9',
  title: 'An influence edge is attached to a position or a documented edge',
  layer: 'atlas',
  severity: 'error',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const resolved = ctx.resolved;
    if (!resolved) return findings;

    const institutionOfRole = new Map<string, string>();
    for (const role of (ctx.records.role ?? []) as unknown as Row[]) {
      if (text(role.id) && text(role.institution)) institutionOfRole.set(text(role.id), text(role.institution));
    }

    const holds = new Set<string>();
    for (const position of (ctx.records.position ?? []) as unknown as Row[]) {
      if (text(position.holder)) holds.add(text(position.holder));
      const institution = institutionOfRole.get(text(position.role));
      if (institution) holds.add(institution);
    }

    const documented = new Set<string>();
    const relationships = (ctx.records.relationship ?? []) as unknown as Row[];
    for (const edge of relationships) {
      if (INFLUENCE_TYPES.has(text(edge.type))) continue;
      if (resolved.basis.get(`relationship:${text(edge.id)}`) !== 'documented') continue;
      documented.add(text(edge.from));
      documented.add(text(edge.to));
    }

    for (const edge of relationships) {
      const type = text(edge.type);
      if (!INFLUENCE_TYPES.has(type)) continue;
      const from = text(edge.from);
      const to = text(edge.to);
      if (holds.has(from) || holds.has(to) || documented.has(from) || documented.has(to)) continue;
      findings.push({
        rule: 'V9',
        severity: type === 'reported-influence' ? 'warning' : 'error',
        record: { kind: 'relationship', id: text(edge.id) },
        message: `${type} edge ${from} → ${to} is unmoored — neither endpoint has a position or a documented edge (V9)`
      });
    }
    return findings;
  }
});
