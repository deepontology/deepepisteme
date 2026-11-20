/**
 * kernel/evidence.ts: claim-level evidence (V29), the passage rather than the
 * bibliography.
 *
 * `sources` says which records carry a claim; it does not say where in them,
 * or whether the cited page was ever captured. An evidence entry binds the
 * claim to an exact passage and a locator, and requires either a real capture
 * or a dated promise to make one. `lineage` names the originating report and
 * each republishing step, so two outlets sharing one wire count as one origin.
 *
 * This is the shape every claim-bearing kind's optional `evidence` list holds,
 * so it lives once in the kernel: evidence passages are true of any ledger of
 * contested claims. No country, no module state.
 */

import { z } from 'zod';
import { nonBlank } from './envelope.ts';
import { isArchiveSnapshot } from './kinds.ts';

export const EvidenceSchema = z
  .strictObject({
    passage_type: z.enum(['quote', 'paraphrase']),
    /** Verbatim for `quote`; a close reading, marked as such, for `paraphrase`. */
    passage: z
      .string()
      .refine((v) => nonBlank(v, 10), 'a passage must be at least 10 non-blank characters'),
    /** Page, article section or timestamp: where in the source the passage sits. */
    locator: z
      .string()
      .refine((v) => nonBlank(v, 2), 'evidence needs a locator (page, section or timestamp)'),
    retrieved_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'retrieved_at must be an ISO date (YYYY-MM-DD)'),
    /** A real snapshot, never a generated archive lookup. */
    capture_url: z
      .string()
      .url()
      .refine(
        isArchiveSnapshot,
        'capture_url must be an actual snapshot (timestamped), not a year-only or date-only archive lookup (V29)'
      )
      .optional(),
    /** When no capture exists yet, the date a retry is owed. */
    capture_missing: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'capture_missing must be an ISO retry date (YYYY-MM-DD)')
      .optional(),
    /** Originating report plus each republishing step, in order. */
    lineage: z
      .array(z.strictObject({ publisher: z.string().min(2), url: z.string().url().optional() }))
      .default([])
  })
  .superRefine((e, ctx) => {
    if (!e.capture_url && !e.capture_missing) {
      ctx.addIssue({
        code: 'custom',
        message: 'evidence needs a capture_url, or capture_missing with the retry date (V29)'
      });
    }
  });
