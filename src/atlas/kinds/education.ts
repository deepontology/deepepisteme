/**
 * atlas/kinds/education.ts: a credential path, a record kind so several
 * people's academic timelines can overlap and be checked like any interval.
 *
 * `institution` is the graph entity when the school has a record, null when
 * it does not; a school with no record is not a reason to drop the degree.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { claimFields, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The education kind's object schema, before the envelope is applied. */
export function educationSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    person: slug,
    /** Graph institution when extant; null when the school has no record. */
    institution: slug.nullable(),
    degree_en: z.string().min(1),
    degree_fr: z.string().optional(),
    degree_ar: z.string().optional(),
    field: z.string().optional(),
    ...translatable('field', l.translatedLocales),
    kind: z.enum(['phd', 'masters', 'licence', 'baccalaureate', 'certificate', 'other']),
    start: dateToken.optional(),
    end: dateToken.optional(),
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    ...claimFields(l.review),
    evidence: z.array(EvidenceSchema).optional()
  });
}
