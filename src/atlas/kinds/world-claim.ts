/**
 * atlas/kinds/world-claim.ts: the dossier's shelf — claims about the
 * jurisdiction's place in the world.
 *
 * Two shapes of claim, one record kind: aggregates the measured flow
 * families cannot cover (total public debt, tourism receipts), and contested
 * circulating claims (kept, never deleted) graded D with attribution, beside
 * the measured reality in `assessment`.
 *
 * `entity` is the graph institution id the claim is about, or null when the
 * claim is about the jurisdiction itself. A claim is never a measurement: it
 * carries the full envelope and at least one source.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { DisputeSchema } from '../../kernel/review.ts';
import { claimAxes, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The world-claim kind's object schema, before the envelope is applied. */
export function worldClaimSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    /** Graph institution id, or null when the claim is about the jurisdiction itself. */
    entity: slug.nullable().default(null),
    claim: z.string().min(10),
    /** What the evidence shows — the counter or the boundary, stated. */
    assessment: z.string().min(10),
    confidence: Confidence.default('C'),
    /** Overrides the basis derived from `confidence`. */
    basis: Basis.optional(),
    verification: Verification.default('unflagged'),
    /** Whose claim this is, mandatory for anything below grade B. */
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** V27 — why the authored `basis` overrides the grade-implied basis. */
    basis_override_reason: z.string().optional(),
    ...claimAxes,
    evidence: z.array(EvidenceSchema).optional(),
    disputes: z.array(DisputeSchema).default([]),
    review: l.review.optional(),
    notes: z.array(z.string()).default([]),
    sources: z.array(slug).min(1, 'every world claim needs at least one source'),
    ...translatable('claim', l.translatedLocales),
    ...translatable('assessment', l.translatedLocales),
    ...translatable('notes', l.translatedLocales, 'list')
  });
}
