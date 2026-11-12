/**
 * kernel/envelope.ts: the evidence envelope every claim-bearing kind carries.
 *
 *   * Mandatory prose is checked with nonBlank: whitespace is a missing field.
 *   * A derived `inferred` claim needs reasoning and a falsifier; a derived
 *     `unsubstantiated` claim needs attribution; grade C/D claims need
 *     attribution.
 *   * Required kinds must cite at least one source.
 *   * An authored basis stronger than the grade implies is an override. It
 *     requires a review, reasoning, a falsifier where an inference is involved,
 *     a source and `basis_override_reason`; registered overrides are enumerated
 *     as live exceptions instead of being silently reverted.
 *
 * The exception sets arrive as an argument. They may be a live getter, so a
 * caller can replace them between parses without any module state here.
 */

import { z } from 'zod';
import { deriveBasis, isBasisUpgrade } from './basis.ts';
import { NO_EXCEPTIONS, type EnvelopeExceptions } from './exceptions.ts';

/** Ids are lowercase kebab-case. */
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids must be lowercase kebab-case');

/**
 * A mandatory text field is satisfied only by a string with real content.
 * `z.string().min(1)` accepts a single space; a required field that whitespace
 * satisfies is not required. Callers pass the field's existing minimum.
 */
export function nonBlank(v: unknown, min = 1): boolean {
  return typeof v === 'string' && v.trim().length >= min;
}

export type ExceptionSource = EnvelopeExceptions | (() => EnvelopeExceptions) | undefined;

function live(source: ExceptionSource): EnvelopeExceptions {
  if (!source) return NO_EXCEPTIONS;
  return typeof source === 'function' ? source() : source;
}

/**
 * Shared claim envelope, applied to every claim-bearing kind so no future kind
 * can forget it. `kind` decides whether a source is required; the deployment
 * supplies the list of such kinds.
 */
export function withClaimEnvelope<S extends z.ZodObject<z.ZodRawShape>>(
  kind: string,
  schema: S,
  exceptions?: ExceptionSource
) {
  return schema
    .refine(
      (r: any) => !((r.confidence === 'C' || r.confidence === 'D') && !nonBlank(r.attributed_to)),
      { message: 'grade C/D claims must name who is making the claim (attributed_to, non-blank)' }
    )
    .refine(
      (r: any) => {
        const derived = deriveBasis(r.confidence, r.verification, r.basis);
        return !(derived === 'inferred' && (!nonBlank(r.reasoning) || !nonBlank(r.falsifiable_by)));
      },
      { message: 'an inferred claim must state its reasoning and what would falsify it (non-blank)' }
    )
    .refine(
      (r: any) =>
        !(
          deriveBasis(r.confidence, r.verification, r.basis) === 'unsubstantiated' &&
          !nonBlank(r.attributed_to)
        ),
      { message: 'an unsubstantiated claim must name where the claim circulates (non-blank)' }
    )
    .refine(
      (r: any) => {
        if (!REQUIRED_SOURCE_KINDS.has(kind)) return true;
        if ((r.sources?.length ?? 0) > 0) return true;
        return live(exceptions).emptySources?.has(`${kind}:${r.id}`) ?? false;
      },
      {
        message:
          'rule 2: every claim record must cite at least one source, or be listed in the exception register with an owner and a deadline'
      }
    )
    .superRefine((r: any, ctx) => {
      if (!r.basis) return;
      const derived = deriveBasis(r.confidence, r.verification, undefined);
      if (!isBasisUpgrade(r.basis, derived)) return;
      if (live(exceptions).basisOverrides?.has(`${kind}:${r.id}:${derived}>${r.basis}`)) return;
      const pair = `authored basis "${r.basis}" over grade-implied "${derived}"`;
      const issue = (missing: string) =>
        ctx.addIssue({ code: 'custom', message: `${pair}: ${missing}`, path: ['basis'] });
      if (!r.review) issue('a basis override requires a review object with a date and method');
      if (!nonBlank(r.reasoning)) issue('a basis override requires non-blank reasoning');
      if ((r.basis === 'inferred' || derived === 'inferred') && !nonBlank(r.falsifiable_by)) {
        issue('a basis override on an inference requires a non-blank falsifiable_by');
      }
      if ((r.sources?.length ?? 0) < 1) issue('a basis override requires at least one source');
      if (!nonBlank(r.basis_override_reason, 10)) {
        issue(
          'a basis override requires basis_override_reason of at least 10 non-blank characters, or a live exception-register entry'
        );
      }
    });
}

/**
 * Claim records that must cite at least one source. Roles, questions, regions,
 * eras and institutions are scaffolding: their standing is carried by the
 * records inside them.
 */
export const REQUIRED_SOURCE_KINDS = new Set([
  'institution',
  'person',
  'position',
  'relationship',
  'event',
  'agreement',
  'world-claim',
  'company',
  'contract',
  'licence',
  'declaration',
  'education',
  'place'
]);
