/**
 * atlas/kinds/relationship.ts: the edges themselves.
 *
 * Ported from the consumer's schema. Claim-bearing: parse() applies the
 * envelope per call. The kind's own refinements chain AFTER the envelope
 * (`relationshipRefines`, registered as the kind's `afterEnvelope`), so a
 * broken record's issue list keeps the order the consumer's records have
 * always published: the envelope's findings first, then the edge's own.
 *
 * The `type` vocabulary and the influence channels are the deployment's, read
 * through the literals.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { DisputeSchema } from '../../kernel/review.ts';
import { claimAxes, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The relationship kind's object schema, before the envelope is applied. */
export function relationshipSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    from: slug,
    to: slug,
    type: z.enum(l.relationshipTypes as unknown as [string, ...string[]]),
    /** Free-text qualifier, e.g. "son-in-law", "51% shareholder". */
    subtype: z.string().optional(),
    start: dateToken.optional(),
    end: dateToken.optional(),
    description: z.string().min(4),
    confidence: Confidence,
    /** Overrides the basis derived from `confidence`. */
    basis: Basis.optional(),
    verification: Verification.default('unflagged'),
    /** Whose claim this is, mandatory for anything below grade B. */
    attributed_to: z.string().optional(),
    /** Required for inferred claims. */
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** V27 — why the authored `basis` overrides the grade-implied basis. */
    basis_override_reason: z.string().optional(),
    ...claimAxes,
    evidence: z.array(EvidenceSchema).optional(),
    disputes: z.array(DisputeSchema).default([]),
    /** This record was merged into another. */
    merged_into: slug.optional(),
    /** This relationship supersedes another record of the same kind. */
    supersedes: slug.optional(),
    review: l.review.optional(),
    sources: z.array(slug).default([]),
    ...translatable('description', l.translatedLocales),
    ...translatable('reasoning', l.translatedLocales),
    ...translatable('falsifiable_by', l.translatedLocales),
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    equity: z
      .strictObject({
        pct: z.number().min(0).max(100),
        direct: z.boolean().default(true),
        beneficial: z.boolean().default(false),
        class: z.string().optional()
      })
      .optional(),
    finance: z
      .strictObject({
        amount: z.number().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code'),
        year: z.number().int().min(1956).max(2030)
      })
      .optional(),
    /**
     * Influence metadata: allowed only on the influence families, and
     * `strength` is an editorial judgment that must state its reasoning (V9) —
     * the same contract as the `authority` weight on roles.
     */
    influence: z
      .strictObject({
        channel: z.enum(l.influenceChannels as unknown as [string, ...string[]]),
        strength: z.number().min(0.3).max(1)
      })
      .optional()
  });
}

/**
 * The four refinements the consumer chains after the envelope, in their
 * published order and with their published messages.
 */
export function relationshipRefines<S extends z.ZodType>(schema: S): S {
  return schema
    .refine((r) => !((r as { type: string; sources: unknown[] }).type === 'allegation' && (r as { sources: unknown[] }).sources.length === 0), {
      message: 'an allegation must carry a source showing the claim circulates'
    })
    .refine(
      (r) => !(r as { influence?: unknown }).influence ||
        ['influence', 'reported-influence', 'advisory'].includes((r as { type: string }).type),
      {
        message:
          'influence metadata is allowed only on influence-family edges (influence, reported-influence, advisory) — V9'
      }
    )
    .refine((r) => !((r as { influence?: unknown; reasoning?: string }).influence && !(r as { reasoning?: string }).reasoning), {
      message: 'an influence strength is an editorial judgment and must state its reasoning (V9)'
    })
    .refine(
      (r) =>
        !((r as { finance?: unknown }).finance &&
          !['funding', 'sponsorship', 'ownership'].includes((r as { type: string }).type)),
      {
        message: 'finance metadata is allowed only on funding, sponsorship and ownership edges (V13)'
      }
    );
}
