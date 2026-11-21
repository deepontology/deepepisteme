/**
 * atlas/kinds/era.ts: the periodisation of a polity.
 *
 * An era is an analytical thesis about how power was distributed, graded like
 * any claim, but not a claim record: it carries no envelope. Its standing is
 * the standing of the records read through it.
 *
 * Ported from the consumer's schema, including the `label_en`/`label_fr`/
 * `label_ar` name convention (an era needs no `_by` sibling).
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from '../../kernel/basis.ts';
import { slug } from '../../kernel/envelope.ts';
import { dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The era kind's schema. Not claim-bearing: no envelope is applied to it. */
export function eraSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    label_en: z.string().min(2),
    label_fr: z.string().optional(),
    label_ar: z.string().optional(),
    start: dateToken,
    end: dateToken,
    /** The analytical claim about how power was distributed in this era. */
    thesis: z.string().min(10),
    /** Compact power-distribution formula, e.g. "Presidency + Interior > Military". */
    formula: z.string().optional(),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    sources: z.array(slug).default([]),
    confidence: Confidence.optional(),
    verification: Verification.optional(),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    ...translatable('thesis', l.translatedLocales),
    ...translatable('reasoning', l.translatedLocales),
    ...translatable('falsifiable_by', l.translatedLocales)
  });
}
