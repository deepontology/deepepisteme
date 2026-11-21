/**
 * atlas/succession.ts: V24, the succession chain and its published thresholds.
 *
 * A role's holders are a chain: each position's predecessor and successor come
 * from the data, so a gap or an overlap in a command chain surfaces instead of
 * being papered over. The thresholds that decide what counts as a gap or an
 * overlap are arguments, not constants in this file: the caller publishes the
 * same numbers beside the counts, so every published count can be recomputed.
 *
 * - A gap is a handover where no one plausibly held the post for more than
 *   `gapYears`: the next holder's earliest start against the previous holder's
 *   earliest end. Shorter spans read as continuity within date uncertainty.
 *   A previous holder with no end is taken to the cutoff.
 * - An overlap is two holders who certainly sat together for more than
 *   `overlapYears`: the previous holder's latest end against the next holder's
 *   latest start. Only an ended previous interval counts, and only against a
 *   next interval that is not unknown, so a record whose end is simply unknown
 *   or still open does not manufacture an overlap.
 * - A role with `seats` has no chain. Members sit together rather than replace
 *   one another, so a seated role yields no gap, no overlap and no neighbours.
 *
 * This is a derivation, not a rule: it raises no finding. Gaps and overlaps are
 * counts a reader sees, and a gap is an honest record of a vacancy nobody has
 * documented.
 */

import type { ParsedRecords } from '../kernel/rules.ts';
import type { ResolvedInterval } from '../kernel/time.ts';

const YEAR_MS = 365.2425 * 86_400_000;

export interface SuccessionThresholds {
  /** A handover is a gap only when no one plausibly held the post for longer than this, in years. */
  gapYears: number;
  /** Two holders overlap only when they certainly sat together for longer than this, in years. */
  overlapYears: number;
}

export interface SuccessionGap {
  role: string;
  after: string;
  before: string;
  gapYears: number;
}

export interface SuccessionOverlap {
  role: string;
  a: string;
  b: string;
  overlapYears: number;
}

export interface Succession {
  gaps: SuccessionGap[];
  overlaps: SuccessionOverlap[];
  /**
   * For every position of a non-seated role, by position id: the holder before
   * (the authored `predecessor` when the record names one) and the holder after,
   * or null at the end of a chain.
   */
  neighbours: ReadonlyMap<string, { predecessor: string | null; successor: string | null }>;
}

/** What the derivation reads: the parsed records, their intervals and the cutoff. */
export interface SuccessionInput {
  records: ParsedRecords;
  intervals: ReadonlyMap<string, ResolvedInterval>;
  cutoff: number;
}

type Row = { id?: unknown; role?: unknown; holder?: unknown; predecessor?: unknown; seats?: unknown };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function checkThreshold(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`successions: ${name} must be a number of years, zero or more`);
  }
}

export function deriveSuccessions(input: SuccessionInput, thresholds: SuccessionThresholds): Succession {
  checkThreshold('gapYears', thresholds?.gapYears);
  checkThreshold('overlapYears', thresholds?.overlapYears);

  const seated = new Set<string>();
  for (const role of (input.records.role ?? []) as unknown as Row[]) {
    if (role.seats !== undefined) seated.add(text(role.id));
  }

  const byRole = new Map<string, { row: Row; interval: ResolvedInterval }[]>();
  for (const row of (input.records.position ?? []) as unknown as Row[]) {
    const role = text(row.role);
    if (seated.has(role)) continue;
    const interval = input.intervals.get(`position:${text(row.id)}`);
    if (!interval) continue;
    const list = byRole.get(role) ?? [];
    list.push({ row, interval });
    byRole.set(role, list);
  }

  const gaps: SuccessionGap[] = [];
  const overlaps: SuccessionOverlap[] = [];
  const neighbours = new Map<string, { predecessor: string | null; successor: string | null }>();

  for (const [role, list] of byRole) {
    list.sort((a, b) => a.interval.startLatest - b.interval.startLatest);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const prev = list[i - 1];
      const next = list[i + 1];
      const authored = text(cur.row.predecessor);
      neighbours.set(text(cur.row.id), {
        predecessor: authored || (prev ? text(prev.row.holder) : null),
        successor: next ? text(next.row.holder) : null
      });

      if (!prev) continue;
      const prevEnd = prev.interval.endEarliest ?? input.cutoff;
      const gap = (cur.interval.startEarliest - prevEnd) / YEAR_MS;
      if (gap > thresholds.gapYears) {
        gaps.push({
          role,
          after: text(prev.row.holder),
          before: text(cur.row.holder),
          gapYears: Math.round(gap * 10) / 10
        });
      }
      const prevLatestEnd = prev.interval.endLatest ?? input.cutoff;
      const overlap = (prevLatestEnd - cur.interval.startLatest) / YEAR_MS;
      if (overlap > thresholds.overlapYears && prev.interval.status === 'ended' && cur.interval.status !== 'unknown') {
        overlaps.push({
          role,
          a: text(prev.row.holder),
          b: text(cur.row.holder),
          overlapYears: Math.round(overlap * 10) / 10
        });
      }
    }
  }

  return { gaps, overlaps, neighbours };
}
