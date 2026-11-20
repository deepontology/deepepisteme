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
 *   * A source relation is a second axis beside the basis (V26): a relation
 *     that cannot honestly carry the record's kind of claim fails, the
 *     relation and the independence count stand or fall together, and the
 *     count may not exceed the cited sources.
 *
 * The exception sets arrive as an argument. They may be a live getter, so a
 * caller can replace them between parses without any module state here. The
 * words that name where an exception is registered, and the rule id an
 * override issue cites, arrive the same way, so a consumer with a published
 * exception file and a paper's rule numbering gets its exact message strings
 * back and this module names no file of any one deployment.
 */

import { z } from 'zod';
import { deriveBasis, isBasisUpgrade, type BasisValue } from './basis.ts';
import { NO_EXCEPTIONS, type EnvelopeExceptions } from './exceptions.ts';

/**
 * The rule ids the envelope reports under. parse() reads them off each zod
 * issue's `params.rule`, so a finding cites the paper's number rather than the
 * module that happened to check it.
 */
export const ENVELOPE_RULES = Object.freeze({
  sources: 'V12',
  inferred: 'V18',
  attribution: 'V20',
  basisOverride: 'V27',
  sourceRelation: 'V26'
});

/**
 * How the cited sources relate to the claim itself (V26). One axis beside the
 * basis: a relation that cannot honestly carry the record's kind of claim
 * fails the parse, whatever the grade says.
 */
export const SourceRelation = z.enum([
  'direct-record',
  'direct-report',
  'corroborated-report',
  'single-report',
  'inference-from-records',
  'circulating-claim'
]);
export type SourceRelationValue = z.infer<typeof SourceRelation>;

/**
 * V26: which source relationships can honestly carry which kinds of claim.
 * `documented` means the record itself is held, so a report relation
 * contradicts it; `inferred` means nobody states it; a circulating claim is
 * the whole of `unsubstantiated`.
 */
export const RELATION_ALLOWED: Readonly<Record<BasisValue, readonly SourceRelationValue[]>> = {
  documented: ['direct-record'],
  reported: ['direct-report', 'corroborated-report', 'single-report'],
  inferred: ['inference-from-records'],
  unsubstantiated: ['circulating-claim']
};

/**
 * The words an envelope finding carries that a deployment owns: where an
 * exception is recorded, and which rule id a basis-override issue cites. Both
 * are optional; the defaults name no file and no rule, so a consumer passes
 * its own and gets its published message strings back.
 */
export interface EnvelopeTexts {
  /** Where an escape is recorded, as a file name or a register name. */
  readonly exceptionFile?: string;
  /** Rule id a basis-override issue names after the pair, e.g. 'V27'. */
  readonly basisOverrideRule?: string;
}

/** The neutral default: a register, never one deployment's file. */
const DEFAULT_EXCEPTION_FILE = 'the exception register';

/**
 * Rule id for any schema issue. Untagged issues are field-level schema problems
 * and cite V19, the schema audit.
 */
export const SCHEMA_RULE = 'V19';

export function issueRule(issue: unknown): string {
  const params = (issue as { params?: Record<string, unknown> } | null)?.params;
  const rule = params?.rule;
  return typeof rule === 'string' && rule.length > 0 ? rule : SCHEMA_RULE;
}

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
 * True when a claim-bearing record cites no source and no live `no-source`
 * entry excuses it. One predicate, read by the envelope and by rule V12, so the
 * two cannot disagree about which records the register covers.
 */
export function missingSourceCitation(
  kind: string,
  record: { id?: string; sources?: unknown[] },
  exceptions?: EnvelopeExceptions
): boolean {
  if (!REQUIRED_SOURCE_KINDS.has(kind)) return false;
  if ((record.sources?.length ?? 0) > 0) return false;
  return !(exceptions?.emptySources?.has(`${kind}:${record.id}`) ?? false);
}

/**
 * What an authored-basis override still owes, one sentence per missing part.
 * Read by the envelope's superRefine and by rule V27.
 */
export function basisOverrideGaps(
  record: {
    basis?: unknown;
    confidence?: unknown;
    verification?: unknown;
    review?: unknown;
    reasoning?: unknown;
    falsifiable_by?: unknown;
    sources?: unknown[];
    basis_override_reason?: unknown;
  },
  derived: BasisValue,
  texts?: EnvelopeTexts
): string[] {
  const exceptionFile = texts?.exceptionFile ?? DEFAULT_EXCEPTION_FILE;
  const gaps: string[] = [];
  if (!record.review) gaps.push('a basis override requires a review object with a date and method');
  if (!nonBlank(record.reasoning)) gaps.push('a basis override requires non-blank reasoning');
  if ((record.basis === 'inferred' || derived === 'inferred') && !nonBlank(record.falsifiable_by)) {
    gaps.push('a basis override on an inference requires a non-blank falsifiable_by');
  }
  if ((record.sources?.length ?? 0) < 1) gaps.push('a basis override requires at least one source');
  if (!nonBlank(record.basis_override_reason, 10)) {
    gaps.push(
      `a basis override requires basis_override_reason of at least 10 non-blank characters, or a live entry in ${exceptionFile}`
    );
  }
  return gaps;
}

/** The prefix every V27 finding carries: what was authored over what was implied. */
export function basisOverridePair(record: { basis?: unknown }, derived: BasisValue): string {
  return `authored basis "${String(record.basis)}" over grade-implied "${derived}"`;
}

/**
 * Shared claim envelope, applied to every claim-bearing kind so no future kind
 * can forget it. `kind` decides whether a source is required; the deployment
 * supplies the list of such kinds. The exception sets and the message texts
 * arrive as arguments, so the same builder serves two engines with different
 * registers and different published file names.
 */
export function withClaimEnvelope<S extends z.ZodObject<z.ZodRawShape>>(
  kind: string,
  schema: S,
  exceptions?: ExceptionSource,
  texts?: EnvelopeTexts
) {
  const exceptionFile = texts?.exceptionFile ?? DEFAULT_EXCEPTION_FILE;
  const overrideTag = texts?.basisOverrideRule ? ` (${texts.basisOverrideRule})` : '';
  return schema
    .refine(
      (r: any) => !((r.confidence === 'C' || r.confidence === 'D') && !nonBlank(r.attributed_to)),
      {
        message: 'grade C/D claims must name who is making the claim (attributed_to, non-blank)',
        params: { rule: ENVELOPE_RULES.attribution }
      }
    )
    .refine(
      (r: any) => {
        const derived = deriveBasis(r.confidence, r.verification, r.basis);
        return !(derived === 'inferred' && (!nonBlank(r.reasoning) || !nonBlank(r.falsifiable_by)));
      },
      {
        message: 'an inferred claim must state its reasoning and what would falsify it (non-blank)',
        params: { rule: ENVELOPE_RULES.inferred }
      }
    )
    .refine(
      (r: any) =>
        !(
          deriveBasis(r.confidence, r.verification, r.basis) === 'unsubstantiated' &&
          !nonBlank(r.attributed_to)
        ),
      {
        message: 'an unsubstantiated claim must name where the claim circulates (non-blank)',
        params: { rule: ENVELOPE_RULES.attribution }
      }
    )
    .refine((r: any) => !missingSourceCitation(kind, r, live(exceptions)), {
      message: `rule 2: every claim record must cite at least one source, or be listed in ${exceptionFile} with an owner and a deadline`,
      params: { rule: ENVELOPE_RULES.sources }
    })
    .superRefine((r: any, ctx) => {
      if (!r.basis) return;
      const derived = deriveBasis(r.confidence, r.verification, undefined);
      if (!isBasisUpgrade(r.basis, derived)) return;
      if (live(exceptions).basisOverrides?.has(`${kind}:${r.id}:${derived}>${r.basis}`)) return;
      const pair = basisOverridePair(r, derived);
      for (const missing of basisOverrideGaps(r, derived, texts)) {
        ctx.addIssue({
          code: 'custom',
          message: `${pair}${overrideTag}: ${missing}`,
          path: ['basis'],
          params: { rule: ENVELOPE_RULES.basisOverride }
        });
      }
    })
    .superRefine((r: any, ctx) => {
      // V26: the source relationship is checked against the basis the record
      // effectively claims, authored or derived, and the two fields stand or
      // fall together.
      const basis = deriveBasis(r.confidence, r.verification, r.basis);
      if (r.source_relation) {
        const allowed = RELATION_ALLOWED[basis] ?? [];
        if (!allowed.includes(r.source_relation)) {
          ctx.addIssue({
            code: 'custom',
            message: `source_relation "${r.source_relation}" is incompatible with basis "${basis}" (V26)`,
            path: ['source_relation'],
            params: { rule: ENVELOPE_RULES.sourceRelation }
          });
        }
        if (r.independence === undefined) {
          ctx.addIssue({
            code: 'custom',
            message:
              'source_relation requires independence: how many independent origins carry this claim? (V26)',
            path: ['independence'],
            params: { rule: ENVELOPE_RULES.sourceRelation }
          });
        }
      }
      if (r.independence !== undefined && Array.isArray(r.sources) && r.independence > r.sources.length) {
        ctx.addIssue({
          code: 'custom',
          message: `independence ${r.independence} exceeds the ${r.sources.length} cited source(s) (V26)`,
          path: ['independence'],
          params: { rule: ENVELOPE_RULES.sourceRelation }
        });
      }
    });
}

/**
 * Claim records that must cite at least one source. Roles, questions, regions
 * and eras are scaffolding: their standing is carried by the records inside
 * them. A vacancy is a claim like any other: an office that stood empty is a
 * fact someone must have recorded.
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
  'vacancy',
  'declaration',
  'education',
  'place'
]);
