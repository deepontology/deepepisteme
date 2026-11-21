/**
 * atlas/kinds/role.ts: a canonical office, held over time by different people.
 *
 * Not a claim record: a role's standing is carried by the positions and
 * people inside it, so the claim envelope does not apply and `sources` is a
 * courtesy list the referential rules still check.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The role kind's schema. Not claim-bearing: no envelope is applied to it. */
export function roleSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    title_en: z.string().min(2),
    title_fr: z.string().optional(),
    title_ar: z.string().optional(),
    institution: slug,
    /**
     * Formal authority weight, 0-100. This is an explicit editorial judgement,
     * not a computed value, and it is published in the methodology page so
     * readers can disagree with it. It exists so "formal authority" can be
     * ranked without pretending the ranking is objective.
     */
    authority: z.number().min(0).max(100),
    /**
     * The region the office covers, for territorial offices such as a
     * governor. One role per region keeps successions derivable per territory
     * with no extra machinery.
     */
    region: slug.optional(),
    /**
     * Concurrent seats in a collegial body (a legislative term). Holders of a
     * seated role do not succeed one another, so no succession chain is
     * derived for it.
     */
    seats: z.number().int().min(2).optional(),
    /** Chronicle row grouping; defaults to the institution. */
    row: slug.optional(),
    summary: z.string().optional(),
    sources: z.array(slug).default([]),
    ...translatable('summary', l.translatedLocales)
  });
}
