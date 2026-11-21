/**
 * atlas/kinds/contract.ts: procurement, PPP and concession records.
 *
 * An attributed value is a fuzzy token like "~400000000"; a contract with an
 * `award` must either name who reports the figure or draw on a primary
 * source. `status` is required: a contract whose state is unknown says
 * `unknown` rather than nothing.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { claimFields, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The contract kind's object schema, before the envelope is applied. */
export function contractSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    title_en: z.string().min(2),
    title_fr: z.string().optional(),
    title_ar: z.string().optional(),
    /** The buying institution in the graph. */
    institution: slug,
    kind: z.enum(['procurement', 'ppp', 'concession', 'privatisation', 'service', 'construction']),
    procurement: z
      .strictObject({ mechanism: z.string().min(1), advertised: dateToken })
      .optional(),
    /** Attributed value — a fuzzy token, never a number filled from memory. */
    award: z
      .strictObject({
        value: z.string().min(1),
        currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code'),
        year: z.number().int().min(1956).max(2030)
      })
      .optional(),
    winner: slug.optional(),
    losers: z.array(slug).default([]),
    financing: z.strictObject({ type: z.string().min(1), lender: slug.nullable() }).optional(),
    status: z.enum([
      'advertised',
      'awarded',
      'signed',
      'annulled',
      'finished',
      'cancelled',
      'sued',
      'unknown'
    ]),
    start: dateToken.optional(),
    end: dateToken.optional(),
    location: z.array(slug).default([]),
    /** Free-text editorial context (announced-vs-awarded notes, negative findings). */
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    ...claimFields(l.review),
    evidence: z.array(EvidenceSchema).optional()
  });
}
