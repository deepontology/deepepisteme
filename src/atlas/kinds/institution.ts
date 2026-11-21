/**
 * atlas/kinds/institution.ts: an organisation that holds or seeks power.
 *
 * Ported from the consumer's schema, so its records parse byte-identically
 * here: same fields, same defaults, same strictness, same refinement
 * messages. The claim envelope is NOT applied here; parse() applies it per
 * call with that call's exception register, so two engines in one process
 * never share an escape.
 *
 * The vocabulary (types, layers) is the deployment's, read through the
 * literals this builder is handed.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { DisputeSchema, type ReviewSchema } from '../../kernel/review.ts';
import { claimAxes, intervalSpec, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The institution kind's object schema, before the envelope is applied. */
export function institutionSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    name_en: z.string().min(2),
    name_fr: z.string().optional(),
    name_ar: z.string().optional(),
    abbr: z.string().optional(),
    /**
     * How the seats of a legislative term divide between parties where the
     * members are not named: the party's institution id and its seat count.
     * The members' own records replace it wherever they exist.
     */
    seat_split: z.array(z.strictObject({ party: slug, seats: z.number().int().positive() })).optional(),
    aliases: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    type: z.enum(l.institutionTypes as unknown as [string, ...string[]]),
    layer: z.enum(l.layers as unknown as [string, ...string[]]),
    /** Parent institution id, for the command-chain tree. */
    parent: slug.nullable().default(null),
    /**
     * ISO 3166-1 alpha-2 for a foreign-state institution, so a world view can
     * place its record on the globe and link flows to the graph entity.
     */
    iso2: z
      .string()
      .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code')
      .optional(),
    /** ISO 3166-1 alpha-2 host country for an international organisation's seat. */
    seat: z
      .string()
      .regex(/^[A-Z]{2}$/, 'seat must be an ISO 3166-1 alpha-2 host country code')
      .optional(),
    active: intervalSpec.default({}),
    /** Display order within its layer on the Chronicle rows. */
    order: z.number().int().default(100),
    summary: z.string().optional(),
    confidence: Confidence.default('A'),
    basis: Basis.optional(),
    verification: Verification.default('unflagged'),
    /** Whose claim this is, mandatory below grade B. (V20) */
    attributed_to: z.string().optional(),
    /** Required for inferred claims. (V18) */
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /**
     * V27 — why the authored `basis` overrides the basis the grade implies. Min
     * 10 non-blank characters when present; required for every new override.
     */
    basis_override_reason: z.string().optional(),
    ...claimAxes,
    evidence: z.array(EvidenceSchema).optional(),
    disputes: z.array(DisputeSchema).default([]),
    review: l.review.optional(),
    sources: z.array(slug).default([]),
    ...translatable('summary', l.translatedLocales)
  });
}
