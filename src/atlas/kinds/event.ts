/**
 * atlas/kinds/event.ts: a dated turning point, with a causal graph of its
 * own.
 *
 * Ported from the consumer's schema. Claim-bearing: parse() applies the
 * envelope per call. `sources` is required with at least one entry; the
 * category enum is the kind's own taxonomy, unchanged by a deployment.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { DisputeSchema } from '../../kernel/review.ts';
import { claimAxes, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The event kind's object schema, before the envelope is applied. */
export function eventSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    date: dateToken,
    /** Optional end for events that span time (a trial, an uprising). */
    date_end: dateToken.optional(),
    title_en: z.string().min(3),
    title_fr: z.string().optional(),
    title_ar: z.string().optional(),
    category: z.enum([
      'political',
      'military',
      'security',
      'economic',
      'constitutional',
      'election',
      'protest',
      'legal',
      'award',
      'investigation',
      'media'
    ]),
    /** Finer cut than category, for the timeline lanes. */
    subcategory: z.string().optional(),
    /** Place ids. */
    location: z.array(slug).default([]),
    /** Which layers the event moved, when the record can say so. */
    impact: z
      .strictObject({ layer: z.array(z.enum(l.layers as unknown as [string, ...string[]])).default([]) })
      .optional(),
    /** External references the event rests on (decree ids, URLs). */
    documents: z.array(z.string()).default([]),
    materials: z.array(z.string()).default([]),
    /** Event-to-event edges: a cause precedes its consequence (V8). */
    causes: z.array(slug).default([]),
    consequences: z.array(slug).default([]),
    /** Ruptures draw a labelled vertical line across every Chronicle row. */
    rupture: z.boolean().default(false),
    summary: z.string().min(10),
    actors: z.array(slug).default([]),
    institutions: z.array(slug).default([]),
    confidence: Confidence.default('A'),
    basis: Basis.optional(),
    verification: Verification.default('unflagged'),
    /** Whose claim this is, mandatory below grade B. (V20) */
    attributed_to: z.string().optional(),
    /** Required for inferred claims. (V18) */
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** V27 — why the authored `basis` overrides the grade-implied basis. */
    basis_override_reason: z.string().optional(),
    ...claimAxes,
    evidence: z.array(EvidenceSchema).optional(),
    /** Competing characterisations, shown side by side rather than adjudicated. */
    contested: z
      .array(z.strictObject({ framing: z.string(), held_by: z.string(), source: slug.optional() }))
      .default([]),
    disputes: z.array(DisputeSchema).default([]),
    review: l.review.optional(),
    sources: z.array(slug).min(1, 'every event needs at least one source'),
    ...translatable('summary', l.translatedLocales)
  });
}
