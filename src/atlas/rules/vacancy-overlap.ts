/**
 * atlas/rules/vacancy-overlap.ts: V32, an office cannot be vacant and held.
 *
 * A documented vacancy names a known office that has a succession (a seated
 * role has members, not a single holder to be vacant). It may not certainly
 * overlap a titular holder of that office, or another vacancy of it: either is
 * two records saying opposite things about the same days, which is a dispute
 * to record, not a gap to merge. An acting holder may sit inside the interval;
 * that is what an interim is.
 *
 * "Certainly" is the strict reading: the latest start of each falls before
 * the earliest end of the other (the cutoff for a span with no end), so a
 * shared handover day or fuzzy year edges are not a contradiction.
 *
 * Citing a source that does not exist is the source check's finding, not this
 * rule's, and stays where the sources are resolved.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';
import type { ResolvedInterval } from '../../kernel/time.ts';

type VacancyRow = { id?: unknown; role?: unknown };
type RoleRow = { id?: unknown; seats?: unknown };
type PositionRow = { id?: unknown; role?: unknown; acting?: unknown };

function idOf(record: { id?: unknown }): string {
  return typeof record.id === 'string' ? record.id : '';
}

export const V32: Rule = Object.freeze({
  id: 'V32',
  title: 'A vacancy names a known, non-seated office and overlaps no titular holder or other vacancy',
  layer: 'atlas',
  severity: 'error',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const resolved = ctx.resolved;
    if (!resolved) return findings;
    const vacancies = (ctx.records.vacancy ?? []) as unknown as VacancyRow[];
    const roles = new Map((ctx.records.role ?? []).map((r) => [idOf(r as RoleRow), r as RoleRow]));
    const positions = (ctx.records.position ?? []) as unknown as PositionRow[];
    const cutoff = resolved.cutoff;

    const certainlyOverlap = (a: ResolvedInterval, b: ResolvedInterval) =>
      a.startLatest < (b.endEarliest ?? cutoff) && b.startLatest < (a.endEarliest ?? cutoff);
    const span = (kind: string, id: string) => resolved.intervals.get(`${kind}:${id}`);
    const fail = (id: string, message: string) =>
      findings.push({ rule: 'V32', severity: 'error', record: { kind: 'vacancy', id }, message });

    for (const v of vacancies) {
      const id = idOf(v);
      const role = roles.get(typeof v.role === 'string' ? v.role : '');
      if (!role) {
        fail(id, `unknown role "${String(v.role)}" (V32)`);
        continue;
      }
      if (role.seats !== undefined) {
        fail(id, `role "${String(v.role)}" is a seated term, which has no single holder to be vacant (V32)`);
      }
      const own = span('vacancy', id);
      if (!own) continue;
      for (const p of positions) {
        if (p.role !== v.role || p.acting) continue;
        const held = span('position', idOf(p));
        if (held && certainlyOverlap(own, held)) {
          fail(id, `overlaps titular position ${idOf(p)}: the office cannot be both vacant and held (V32)`);
        }
      }
      for (const w of vacancies) {
        const wid = idOf(w);
        if (wid <= id || w.role !== v.role) continue;
        const other = span('vacancy', wid);
        if (other && certainlyOverlap(own, other)) fail(id, `overlaps vacancy ${wid} of the same role (V32)`);
      }
    }
    return findings;
  }
});
