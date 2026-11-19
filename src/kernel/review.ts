/**
 * kernel/review.ts: how a claims record is reviewed, and how it is disputed.
 *
 * A review is signed work: a person or a named pass, a date, a method. Strict
 * objects, because a review that carries an unknown key was written against a
 * shape this engine does not know and must not be trusted to mean the same
 * thing. A dispute is the other direction: a claim that circulates, held by
 * someone, with an optional source and an assessment.
 *
 * The review schema is built per deployment, never at module load: a reviewer
 * is recorded as a role or a named pass, and which passes exist is the
 * deployment's to say. A label ending in ` YYYY-MM-DD` is a dated pass: the
 * prefix is fixed and the date is any calendar-shaped ISO day.
 */

import { z } from 'zod';
import { nonBlank, slug } from './envelope.ts';

export const ReviewMethod = z.enum(['source-check', 'dedup', 'attribute', 'accept-reject', 'judge']);

/** Who performed the review: a person at the source, or a pass run by an agent. */
export const ReviewActor = z.enum(['human', 'agent']);

/** A review schema built for one deployment's reviewer labels. */
export type ReviewSchema = ReturnType<typeof createReviewSchema>;

/** The rule id the review schema's own findings cite. */
const REVIEW_RULE = 'V23';

/** The suffix that marks a label as a dated pass rather than a fixed one. */
const DATED_PASS = ' YYYY-MM-DD';

/**
 * The labels a review may be signed with: the built-in maintainer, the
 * deployment's passes, and the built-in numbered outsider `reviewer-N`.
 */
export function reviewerLabelPattern(labels: readonly string[]): RegExp {
  const parts = [
    'maintainer',
    ...labels.map((label) =>
      label.endsWith(DATED_PASS)
        ? `${escapeRegex(label.slice(0, -DATED_PASS.length))} \\d{4}-\\d{2}-\\d{2}`
        : escapeRegex(label)
    ),
    'reviewer-\\d+'
  ];
  return new RegExp(`^(${parts.join('|')})$`);
}

/** The sentence a rejected reviewer label produces, labels verbatim. */
export function reviewerLabelMessage(labels: readonly string[]): string {
  const listed = labels.join(', ');
  return `reviewer must be a role label: ${listed ? `maintainer, ${listed}, or reviewer-N` : 'maintainer or reviewer-N'} (V23)`;
}

/**
 * The strict review object. `by` is a role label, never a person's name: the
 * record says what kind of check was made and when, which is what a reader
 * can audit. `actor` is optional so a review written before the field existed
 * stays valid; `verified` records must name a human (the consumer's V33), and
 * that check reads `actor` too.
 */
export function createReviewSchema(reviewerLabels: readonly string[]) {
  const labels = reviewerLabelPattern(reviewerLabels);
  const labelMessage = reviewerLabelMessage(reviewerLabels);
  return z.strictObject({
    by: z.string().refine((v) => labels.test(v), {
      message: labelMessage,
      params: { rule: REVIEW_RULE }
    }),
    /** Calendar-valid ISO date. The regex is format-only; the round-trip is the check. */
    date: z
      .string()
      .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), {
        message: 'review date must be an ISO date (YYYY-MM-DD)',
        params: { rule: REVIEW_RULE }
      })
      .refine(
        (d) => {
          const [y, mo, da] = d.split('-').map(Number);
          const t = new Date(Date.UTC(y, mo - 1, da));
          return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da;
        },
        {
          message: 'review date must be a calendar-valid date (V23)',
          params: { rule: REVIEW_RULE }
        }
      ),
    method: ReviewMethod,
    /** Free text describing what was actually checked; the method is the enum. */
    note: z.string().optional(),
    actor: ReviewActor.optional()
  });
}

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

