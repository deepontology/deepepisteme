/**
 * atlas/kinds/vacancy.ts: a documented interval in which an office had no
 * titular holder.
 *
 * Without it the record shows a vacancy the same way it shows an unknown, as
 * a missing row, and the reader cannot tell "nobody held the office, per this
 * source" from "the record has no row". Vacant means no titular holder: an
 * acting holder may sit inside the interval.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { claimFields, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The vacancy kind's object schema, before the envelope is applied. */
export function vacancySchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    /** The office that stood empty. Must be a known, non-seated role. */
    role: slug,
    /** When the last titular holder left. */
    start: dateToken,
    /** When the next titular holder took office; `ongoing` while still vacant. */
    end: dateToken,
    /** Free-text editorial context (who managed the office meanwhile). */
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    ...translatable('reasoning', l.translatedLocales),
    ...translatable('falsifiable_by', l.translatedLocales),
    ...claimFields(l.review),
    evidence: z.array(EvidenceSchema).optional()
  });
}
