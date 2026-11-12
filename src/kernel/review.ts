/**
 * kernel/review.ts: how a claims record is reviewed, and how it is disputed.
 *
 * A review is signed work: a person or a named pass, a date, a method. Strict
 * objects, because a review that carries an unknown key was written against a
 * shape this engine does not know and must not be trusted to mean the same
 * thing. A dispute is the other direction: a claim that circulates, held by
 * someone, with an optional source and an assessment.
 */

import { z } from 'zod';
import { nonBlank, slug } from './envelope.ts';

export const ReviewMethod = z.enum(['source-check', 'dedup', 'attribute', 'accept-reject', 'judge']);

export const ReviewSchema = z.strictObject({
  by: z.string().refine((v) => nonBlank(v, 2), 'reviewer name must be at least 2 non-blank characters'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'review date must be ISO YYYY-MM-DD')
    .refine((d) => {
      const [y, mo, da] = d.split('-').map(Number);
      const t = new Date(Date.UTC(y, mo - 1, da));
      return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da;
    }, 'review date must be calendar-valid'),
  method: ReviewMethod,
  note: z.string().optional()
});

export const DisputeSchema = z.strictObject({
  claim: z
    .string()
    .refine((v) => nonBlank(v, 3), 'a dispute claim must be at least 3 non-blank characters'),
  held_by: z
    .string()
    .refine((v) => nonBlank(v, 2), 'a dispute holder must be at least 2 non-blank characters'),
  source: slug.optional(),
  assessment: z.string().optional(),
  status: z.enum(['open', 'adopted', 'rejected']).optional(),
  resolved_by: z.string().optional(),
  resolved_at: z.string().optional()
});

/** What a deployment says counts as a primary gazette source. */
export interface GazetteVocabulary {
  vocabulary: readonly string[];
  sourcePrefixes: readonly string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A review note may not claim a gazette verification without a gazette source.
 * The vocabulary and the source prefixes are the deployment's.
 */
export function reviewOverclaims(
  gazette: GazetteVocabulary,
  method: string | undefined,
  sources: readonly string[]
): boolean {
  const claimsGazette = new RegExp(`\\b(${gazette.vocabulary.map(escapeRegex).join('|')})\\b`, 'i');
  const gazetteSource = new RegExp(`^(${gazette.sourcePrefixes.map(escapeRegex).join('|')})`);
  if (!method || !claimsGazette.test(method)) return false;
  if (/\bnot\b[^.]{0,40}\b(verified|checked)\b/i.test(method)) return false;
  return !sources.some((s) => gazetteSource.test(s));
}

