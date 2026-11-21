/**
 * atlas/kinds/licence.ts: a time-bound right between an operating company
 * and a state body.
 *
 * `grant` is required and `term`, `scope` and `fees` are strict optional
 * objects, so a licence that says nothing about its duration says so
 * deliberately.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { claimFields, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The licence kind's object schema, before the envelope is applied. */
export function licenceSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    holder: slug,
    issuer: slug,
    kind: z.enum(['spectrum', 'banking', 'mineral', 'media', 'import-export']),
    grant: dateToken,
    term: z.strictObject({ years: z.number().int().positive() }).optional(),
    scope: z
      .strictObject({ frequency: z.string().optional(), region: z.string().min(1) })
      .optional(),
    fees: z
      .strictObject({
        amount: z.number().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code'),
        year: z.number().int().min(1956).max(2030)
      })
      .optional(),
    status: z.enum(['active', 'expired', 'suspended', 'revoked']).default('active'),
    /** Free-text editorial context (decree references, licence chains). */
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    ...claimFields(l.review),
    evidence: z.array(EvidenceSchema).optional()
  });
}
