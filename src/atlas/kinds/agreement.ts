/**
 * atlas/kinds/agreement.ts: a treaty or accession binding the jurisdiction to
 * other states or bodies.
 *
 * A claim in the full sense: a confidence, a basis, sources, disputes.
 * `parties` names every other party; the jurisdiction itself is deliberately
 * never listed, because the selection criterion of the file is that it is
 * party to each one. A party is an alpha-2 state code or the id of an
 * institution record.
 *
 * Ported from the consumer's schema; the kind vocabulary is the deployment's.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { DisputeSchema } from '../../kernel/review.ts';
import { claimAxes, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The agreement kind's object schema, before the envelope is applied. */
export function agreementSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    title_en: z.string().min(3),
    title_fr: z.string().optional(),
    title_ar: z.string().optional(),
    kind: z.enum(l.agreementKinds as unknown as [string, ...string[]]),
    parties: z
      .array(
        z
          .string()
          .regex(
            /^(?:[A-Z]{2}|[a-z0-9][a-z0-9-]*)$/,
            'a party is an ISO alpha-2 state code or an institution id'
          )
      )
      .min(1, 'an agreement needs at least one party'),
    signed: dateToken.optional(),
    in_force: dateToken.optional(),
    text_url: z.string().url().optional(),
    summary: z.string().min(10),
    confidence: Confidence,
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
    sources: z.array(slug).min(1, 'every agreement needs at least one source'),
    ...translatable('summary', l.translatedLocales)
  });
}
