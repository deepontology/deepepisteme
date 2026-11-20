/**
 * atlas/kinds/declaration.ts: a record ABOUT documents, not about the world.
 *
 * The record captures that a document exists and what it says; it never
 * asserts the declared values are true. `declarer` and `body` are required
 * and nullable, because a declaration may belong to a regime or a class of
 * declarants rather than a person, and be held by a body that has no graph
 * record.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { claimFields, dateToken, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** The declaration kind's object schema, before the envelope is applied. */
export function declarationSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    /** Person id; null for regime or class records (a legal regime, a class of declarants). */
    declarer: slug.nullable(),
    date: dateToken,
    kind: z.enum(['asset-declaration', 'income', 'member-of-something', 'dgi-file']),
    jurisdiction: slug,
    /** Institution holding the document, when it is a graph entity. */
    body: slug.nullable(),
    summary: z.string().min(1),
    ...translatable('summary', l.translatedLocales),
    status: z.enum(['available', 'referred', 'sealed', 'destroyed']).default('available'),
    /** Free-text editorial context (filing history, verification status). */
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list'),
    ...claimFields(l.review),
    evidence: z.array(EvidenceSchema).optional()
  });
}
