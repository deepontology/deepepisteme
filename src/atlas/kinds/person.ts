/**
 * atlas/kinds/person.ts: an actor, with a trajectory and the fields a card
 * carries.
 *
 * Ported from the consumer's schema. Claim-bearing: the envelope is applied by
 * parse() per call. `layers` is the deployment's vocabulary; a person in
 * several layers is a bridge node.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { DisputeSchema } from '../../kernel/review.ts';
import { claimAxes, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The person kind's object schema, before the envelope is applied. */
export function personSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    name_en: z.string().min(2),
    name_fr: z.string().optional(),
    name_ar: z.string().optional(),
    /**
     * Alternative transliterations. Essential wherever one script meets
     * another: the same officer appears under different spellings across
     * sources, and near-identical names belong to genuinely different people.
     */
    aliases: z.array(z.string()).default([]),
    birth: dateToken.optional(),
    death: dateToken.optional(),
    /** Place of birth — a places record id, once the gazetteer ships. */
    birthplace: slug.optional(),
    /** ISO alpha-2 citizenships; feeds the foreign layer. */
    nationality: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
    layers: z.array(z.enum(l.layers as unknown as [string, ...string[]])).min(1),
    /** One-line identification shown in tooltips. */
    tagline: z.string().optional(),
    summary: z.string().optional(),
    /** Career arc in short hops, e.g. ["Military", "Intelligence", "Presidency"]. */
    trajectory: z.array(z.string()).default([]),
    confidence: Confidence.default('B'),
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
    disputes: z.array(DisputeSchema).default([]),
    review: l.review.optional(),
    notes: z.array(z.string()).default([]),
    sources: z.array(slug).default([]),
    ...translatable('tagline', l.translatedLocales),
    ...translatable('summary', l.translatedLocales),
    ...translatable('trajectory', l.translatedLocales, 'list'),
    ...translatable('notes', l.translatedLocales, 'list'),
    ...translatable('reasoning', l.translatedLocales),
    ...translatable('falsifiable_by', l.translatedLocales)
  });
}
