/**
 * atlas/kinds/position.ts: the join between a person, a role and a span of
 * time.
 *
 * Ported from the consumer's schema. Claim-bearing: parse() applies the
 * envelope per call. `sources` is required with at least one entry, so an
 * unattributable appointment cannot enter the record silently.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { DisputeSchema } from '../../kernel/review.ts';
import { claimAxes, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The position kind's object schema, before the envelope is applied. */
export function positionSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    role: slug,
    holder: slug,
    start: dateToken.optional(),
    end: dateToken.optional(),
    /** Interim/acting appointment, rendered differently on the Chronicle. */
    acting: z.boolean().default(false),
    /**
     * The seat this position fills, for a role with `seats`. `id` names the
     * constituency within the term; `region` places it on the map. An abroad
     * constituency carries no region.
     */
    constituency: z
      .strictObject({
        id: slug,
        name_en: z.string().min(2),
        name_fr: z.string().optional(),
        name_ar: z.string().optional(),
        region: slug.optional(),
        abroad: z.boolean().default(false)
      })
      .optional(),
    /** Explicit predecessor override. Otherwise derived from the role's sequence. */
    predecessor: slug.nullable().optional(),
    /** This position supersedes another record of the same kind. */
    supersedes: slug.optional(),
    confidence: Confidence.default('B'),
    /** Overrides the basis derived from `confidence`. */
    basis: Basis.optional(),
    verification: Verification.default('unflagged'),
    /** Whose claim this is, mandatory below grade B. (V20) */
    attributed_to: z.string().optional(),
    /** Required for inferred claims: why this is reasoned, and what would refute it. */
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** V27 — why the authored `basis` overrides the grade-implied basis. */
    basis_override_reason: z.string().optional(),
    ...claimAxes,
    evidence: z.array(EvidenceSchema).optional(),
    /** Competing versions of the same span, recorded rather than silently resolved. */
    disputes: z.array(DisputeSchema).default([]),
    /** This record was merged into another. */
    merged_into: slug.optional(),
    review: l.review.optional(),
    notes: z.array(z.string()).default([]),
    sources: z.array(slug).min(1, 'every position needs at least one source'),
    ...translatable('reasoning', l.translatedLocales),
    ...translatable('falsifiable_by', l.translatedLocales),
    ...translatable('notes', l.translatedLocales, 'list')
  });
}
