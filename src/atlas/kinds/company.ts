/**
 * atlas/kinds/company.ts: a corporate identity keyed by an institution id, so
 * the graph node and the corporate record can never desync.
 *
 * `registration.registry` must name one of the deployment's listed
 * registries. The `capital` object's amount field is carried under the name
 * the consumer's records have always written it (an ISO 4217 code), because
 * the port must keep the same fields.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { claimFields, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The company kind's object schema, before the envelope is applied. */
export function companySchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug, // MUST be the id of an institution of a company-like type (checked at validate)
    legal_name_en: z.string().optional(),
    legal_name_fr: z.string().optional(),
    legal_name_ar: z.string().optional(),
    legal_form: z.string().optional(),
    registration: z
      .strictObject({
        /** The registry this number belongs to — one of the deployment's listed registries. */
        registry: slug.refine((r) => l.registries.includes(r), {
          // zod 4 runs a function message but types the field as a string;
          // the consumer's own schema passes the same function.
          message: (() =>
            `registry must be one of the jurisdiction's registries: ${l.registries.join(', ')} (parameters.jurisdiction.registry.registries)`) as unknown as string
        }),
        number: z.string().min(1),
        date: dateToken
      })
      .optional(),
    /** The registry's own exact identifier for the company, when it has one. */
    cin: z.string().optional(),
    status: z
      .enum(['active', 'dissolved', 'liquidated', 'dormant', 'confiscated', 'delisted'])
      .default('active'),
    founded: dateToken.optional(),
    /** Capital is a claim about a balance-sheet date: numbers never float free. */
    capital: z.strictObject({ tnd: z.number().positive(), date: dateToken }).optional(),
    state_owned: z.boolean().default(false),
    activities: z.array(z.string()).default([]),
    /** Place id. */
    headquarters: slug.optional(),
    /** Free-text editorial context (registry gaps, flag resolution, capital mechanics). */
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    ...claimFields(l.review),
    evidence: z.array(EvidenceSchema).optional()
  });
}
