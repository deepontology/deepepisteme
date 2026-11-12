/**
 * kernel/kinds.ts: the record kinds a ledger of contested claims has, whatever
 * the subject.
 *
 * Slice 2 owns four of them: the source register, the open question, the
 * hypothesis and the independent verification. They move from deeptunisia with
 * the envelope and the provenance already attached; the rules that read them
 * live in kernel/rules.ts and arrive in later slices.
 *
 * Each schema is built inside createEngine, never at module load, because the
 * lists a schema validates against are the deployment's: the languages a
 * translation may carry and the languages a source may be written in. A schema
 * here names no country and no file.
 *
 * A claim-bearing kind is declared as its plain object schema. The envelope is
 * applied by parse(), with that call's exception sets, so an excepted record
 * parses exactly like a compliant one without any state held between calls.
 */

import { z } from 'zod';
import { Basis, Confidence, Verification } from './basis.ts';
import { SCHEMA_RULE, nonBlank, slug, withClaimEnvelope } from './envelope.ts';
import { DisputeSchema, ReviewSchema } from './review.ts';
import { TranslatedBy } from './translation.ts';

/** The deployment values the kernel schemas validate against. */
export interface KindLiterals {
  /** Languages a source may be written in. */
  readonly sourceLanguages: readonly string[];
  /** Languages prose is translated into. */
  readonly translatedLocales: readonly string[];
}

/** One record kind: what it is called, what file holds it, and its schema. */
export interface KindDefinition {
  kind: string;
  file: string;
  /**
   * The record schema. For a claim-bearing kind this is the plain object
   * schema; parse() applies the claim envelope with the exception sets it was
   * given. A deployment kind declared with bearsClaims must be a plain object
   * schema for the same reason.
   */
  schema: z.ZodType;
  bearsClaims: boolean;
  layer: 'kernel' | 'atlas' | 'deployment';
}

/** The kinds this slice registers, in the order parse() returns them. */
export const KERNEL_KIND_NAMES = ['source', 'question', 'hypothesis', 'verification'] as const;

/** The rule id the ported kind schemas cite where their source names one. */
const EVIDENCE_RULE = 'V29';

function translatable(
  name: string,
  locales: readonly string[],
  kind: 'string' | 'list' = 'string'
): Record<string, z.ZodTypeAny> {
  const value = kind === 'list' ? z.array(z.string()) : z.string();
  return Object.fromEntries(
    locales.flatMap((loc) => [
      [`${name}_${loc}`, value.optional()],
      [`${name}_${loc}_by`, TranslatedBy.optional()]
    ])
  );
}

/**
 * A registered snapshot, not a lookup. Only archive URLs are checked, because
 * that is where a generated link resolves to whichever capture is nearest,
 * which is not evidence that the page was read.
 */
export function isArchiveSnapshot(url: string): boolean {
  if (!/^https?:\/\/(www\.)?web\.archive\.org\//i.test(url)) return true;
  return /^https?:\/\/(www\.)?web\.archive\.org\/web\/\d{14}(?:[a-z_]+)?\//i.test(url);
}

// ---------------------------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------------------------

/** A citation record. Not a claim: it is what a claim points at. */
export function sourceSchema(literals: KindLiterals) {
  return z.strictObject({
    id: slug,
    kind: z.literal('source').optional(),
    title: z.string().min(3),
    publisher: z.string().min(2),
    date: z.string().optional(),
    /** A source URL is a web link, not any URI. */
    url: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//i.test(v), {
        message: 'a source URL must be http(s) (V29)',
        params: { rule: EVIDENCE_RULE }
      }),
    archive_url: z
      .string()
      .url()
      .refine(isArchiveSnapshot, {
        message:
          'a web.archive.org archive_url must be an actual snapshot (timestamped), not a year-only or date-only archive lookup (V29)',
        params: { rule: EVIDENCE_RULE }
      })
      .optional(),
    /** 1 primary, 2 institutional research, 3 international journalism, 4 regional, 5 lead. */
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    lang: z.enum(literals.sourceLanguages as unknown as [string, ...string[]]).default('en'),
    excerpt: z.string().optional(),
    note: z.string().optional(),
    notes: z.array(z.string()).optional(),
    tier_note: z.string().optional(),
    ...translatable('excerpt', literals.translatedLocales),
    ...translatable('title_gloss', literals.translatedLocales)
  });
}

// ---------------------------------------------------------------------------------------------
// Question
// ---------------------------------------------------------------------------------------------

/** A typed assertion a narrative claim makes about a canonical record. */
export const NarrativeReferenceSchema = z.strictObject({
  person: slug,
  role: slug.optional(),
  institution: slug.optional(),
  /** An exact date on purpose: a range cannot be contradicted cleanly. */
  on: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: 'a typed reference needs an exact date (YYYY-MM-DD), not a range or a ?',
    params: { rule: SCHEMA_RULE }
  }),
  note: z.string().max(400).optional()
});

/**
 * An open research question. The question is scaffolding; an answer is a claim
 * and carries its own standing. Both stay on one record, as deeptunisia has
 * them.
 */
export function questionSchema(literals: KindLiterals) {
  return z.strictObject({
    id: slug,
    question: z.string().min(10),
    kind: z.enum(['verification', 'analytical']),
    status: z.enum(['open', 'partial', 'answered']).default('open'),
    relates_to: z.array(slug).default([]),
    references: z.array(NarrativeReferenceSchema).default([]),
    notes: z.string().optional(),
    answer: z.string().optional(),
    basis: Basis.optional(),
    confidence: Confidence.optional(),
    verification: Verification.optional(),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    sources: z.array(slug).default([]),
    ...translatable('question', literals.translatedLocales),
    ...translatable('notes', literals.translatedLocales),
    ...translatable('answer', literals.translatedLocales)
  });
}

// ---------------------------------------------------------------------------------------------
// Hypothesis
// ---------------------------------------------------------------------------------------------

/** Which source relationships can honestly carry which kinds of claim. */
const SourceRelation = z.enum([
  'direct-record',
  'direct-report',
  'corroborated-report',
  'single-report',
  'inference-from-records',
  'circulating-claim'
]);

/** The two axes that make the source relationship explicit on a claim. */
const claimAxes = {
  source_relation: SourceRelation.optional(),
  independence: z.number().int().min(1).optional()
};

/** The claim envelope's fields, shared by a hypothesis's evidence findings. */
const claimFields = {
  confidence: Confidence.default('B'),
  basis: Basis.optional(),
  verification: Verification.default('unflagged'),
  attributed_to: z.string().optional(),
  reasoning: z.string().optional(),
  falsifiable_by: z.string().optional(),
  basis_override_reason: z.string().optional(),
  ...claimAxes,
  disputes: z.array(DisputeSchema).default([]),
  review: ReviewSchema.optional(),
  sources: z.array(slug).min(1, 'every claim record needs at least one source')
};

/** One evidence finding tested against a hypothesis's falsifier clause. */
function hypothesisEvidenceSchema(literals: KindLiterals) {
  return withClaimEnvelope(
    'hypothesis-evidence',
    z.strictObject({
      falsifier_part: z.string().optional(),
      finding: z.enum(['supports', 'contradicts', 'neutral']),
      evidence: z.string().min(10),
      ...translatable('evidence', literals.translatedLocales),
      falsifier_progress: z.string().optional(),
      ...translatable('falsifier_progress', literals.translatedLocales),
      note: z.string().optional(),
      ...translatable('note', literals.translatedLocales),
      references: z.array(NarrativeReferenceSchema).default([]),
      ...claimFields
    })
  );
}

/**
 * A hypothesis. Falsifiability is mandatory: a claim that cannot be falsified
 * is a belief, and this is not a ledger of beliefs.
 */
export function hypothesisSchema(literals: KindLiterals) {
  return z.strictObject({
    id: slug,
    label: z.string().min(3),
    statement: z.string().min(10),
    support: z.enum(['strong', 'moderate', 'insufficient', 'contradicted']),
    reasoning: z.string().min(10),
    falsifiable_by: z.string().min(10),
    sources: z.array(slug).default([]),
    references: z.array(NarrativeReferenceSchema).default([]),
    evidence: z.array(hypothesisEvidenceSchema(literals)).default([]),
    ...translatable('label', literals.translatedLocales),
    ...translatable('statement', literals.translatedLocales),
    ...translatable('reasoning', literals.translatedLocales),
    ...translatable('falsifiable_by', literals.translatedLocales)
  });
}

// ---------------------------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------------------------

/**
 * The evidence that an independent check happened: deliberately its own record
 * kind, never a flag on the editorial review object. The two populations are
 * never added together.
 */
export function verificationSchema() {
  return z.strictObject({
    id: slug,
    /** The record checked, as `kind:id`. */
    claim: z.string().min(3),
    /** The claim kind, so coverage can be reported per kind. */
    kind: slug,
    basis: Basis,
    date: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: 'a verification needs a YYYY-MM-DD date',
      params: { rule: SCHEMA_RULE }
    }),
    by: z.string().min(2),
    method: z.string().min(2),
    /** Whether the rater was shown the project's own grade. */
    blinded: z.boolean().default(true),
    outcome: z.enum(['supported', 'refuted', 'disputed', 'unresolved', 'insufficient_evidence']),
    sources: z.array(slug).default([]),
    note: z.string().max(2000).optional()
  });
}

// ---------------------------------------------------------------------------------------------
// The register of kinds
// ---------------------------------------------------------------------------------------------

export type SourceRecord = z.infer<ReturnType<typeof sourceSchema>>;
export type QuestionRecord = z.infer<ReturnType<typeof questionSchema>>;
export type HypothesisRecord = z.infer<ReturnType<typeof hypothesisSchema>>;
export type VerificationRecord = z.infer<ReturnType<typeof verificationSchema>>;

/** The four kernel kinds, built for one deployment's literals. */
export function createKernelKinds(literals: KindLiterals): readonly KindDefinition[] {
  return Object.freeze([
    { kind: 'source', file: 'sources.yaml', schema: sourceSchema(literals), bearsClaims: false, layer: 'kernel' },
    {
      kind: 'question',
      file: 'questions.yaml',
      schema: questionSchema(literals),
      bearsClaims: false,
      layer: 'kernel'
    },
    {
      kind: 'hypothesis',
      file: 'hypotheses.yaml',
      schema: hypothesisSchema(literals),
      bearsClaims: false,
      layer: 'kernel'
    },
    {
      kind: 'verification',
      file: 'verifications.yaml',
      schema: verificationSchema(),
      bearsClaims: false,
      layer: 'kernel'
    }
  ]);
}

/**
 * The object schema the envelope can wrap. A claim-bearing kind declared with
 * anything else is a deployment error, reported at createEngine.
 *
 * Declaration convention: a claim-bearing kind is declared WITHOUT the claim
 * envelope, because parse() applies it per call with that call's register.
 * Zod 4 returns the same object schema from a refine, so a deployment that
 * wrapped its own record cannot be told apart here; wrapping one twice reports
 * each envelope gap twice.
 */
export function objectSchemaOf(def: KindDefinition): z.ZodObject<z.ZodRawShape> {
  if (!(def.schema instanceof z.ZodObject)) {
    throw new Error(
      `kind "${def.kind}": bearsClaims needs an object schema, because the envelope is applied per parse call`
    );
  }
  return def.schema;
}

/** Close a claim-bearing kind's schema over one call's exception sets. */
export function envelopedSchema(
  def: KindDefinition,
  exceptions: Parameters<typeof withClaimEnvelope>[2]
): z.ZodType {
  if (!def.bearsClaims) return def.schema;
  return withClaimEnvelope(def.kind, objectSchemaOf(def), exceptions);
}
