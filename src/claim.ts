/**
 * claim.ts: the v0.1 evidence module, now a view of one engine.
 *
 * The envelope itself (grades, basis, reviews, disputes, the exception sets)
 * and the power-map vocabulary live in kernel/ and atlas/. This module keeps
 * the old import path working for deeptunisia's scripts: it re-exports those
 * pieces and builds the record schemas from them. The exception sets it was
 * configured with are handed to the envelope as a live getter.
 *
 * removed in slice 3
 */

import { z } from 'zod';
import {
  Basis,
  Confidence,
  ConfidenceValue,
  Verification,
  ReviewMethod,
  TranslatedBy,
  ReviewSchema,
  DisputeSchema,
  deriveBasis,
  isBasisUpgrade,
  nonBlank,
  slug,
  REQUIRED_SOURCE_KINDS,
  TRANSLATION_TIERS,
  type BasisValue,
  type EnvelopeExceptions
} from './kernel/index.ts';
import {
  edgeDirection,
  influenceChannels,
  institutionTypes,
  layers,
  relationshipTypes,
  type EdgeDirectionKind
} from './atlas/vocabulary.ts';
import { legacyEngine } from './legacy.ts';

export {
  Basis,
  Confidence,
  Verification,
  ReviewMethod,
  TranslatedBy,
  ReviewSchema,
  DisputeSchema,
  deriveBasis,
  isBasisUpgrade,
  nonBlank,
  REQUIRED_SOURCE_KINDS,
  TRANSLATION_TIERS
};
export type { BasisValue, ConfidenceValue };

/** Explicit escapes the envelope is parsed with. */
export type SchemaExceptions = EnvelopeExceptions;

let schemaExceptions: EnvelopeExceptions = {};

export function configureClaimExceptions(exceptions: EnvelopeExceptions): void {
  schemaExceptions = exceptions;
}

export function withClaimEnvelope<S extends z.ZodObject<z.ZodRawShape>>(kind: string, schema: S) {
  return legacyEngine.envelope.withClaimEnvelope(kind, schema, () => schemaExceptions);
}

export const TRANSLATED_LOCALES = legacyEngine.deployment.translatedLocales;

/** A review note may not claim a gazette verification without a gazette source. */
export function reviewOverclaims(method: string | undefined, sources: string[]): boolean {
  return legacyEngine.envelope.reviewOverclaims(method, sources);
}

export function translatable(name: string, kind: 'string' | 'list' = 'string') {
  const value = kind === 'list' ? z.array(z.string()) : z.string();
  return Object.fromEntries(
    TRANSLATED_LOCALES.flatMap((loc) => [
      [`${name}_${loc}`, value.optional()],
      [`${name}_${loc}_by`, TranslatedBy.optional()]
    ])
  ) as Record<string, z.ZodTypeAny>;
}

export const InstitutionType = z.enum(institutionTypes);

export const Layer = z.enum(layers);

export const RelationshipType = z.enum(relationshipTypes);

export type DirectionKind = EdgeDirectionKind;
export const EDGE_DIRECTION = edgeDirection;

export const INFLUENCE_CHANNELS = influenceChannels;

export const SourceSchema = z.strictObject({
  id: slug,
  title: z.string().min(3),
  publisher: z.string().min(2),
  date: z.string().optional(),
  url: z.string().url(),
  archive_url: z.string().url().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  lang: z.enum(['ar', 'fr', 'en', 'it', 'de']).default('en'),
  excerpt: z.string().optional(),
  ...translatable('excerpt'),
  ...translatable('title_gloss')
});

export const InstitutionSchema = withClaimEnvelope(
  'institution',
  z.strictObject({
    id: slug,
    name_en: z.string().min(2),
    name_fr: z.string().optional(),
    name_ar: z.string().optional(),
    abbr: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
    ...translatable('notes', 'list'),
    type: InstitutionType,
    layer: Layer,
    parent: slug.nullable().default(null),
    active: z.strictObject({ start: z.string().optional(), end: z.string().optional() }).default({}),
    order: z.number().int().default(100),
    summary: z.string().optional(),
    confidence: Confidence.default('A'),
    basis: Basis.optional(),
    verification: Verification.default('verified'),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** Why the authored basis overrides the grade-implied basis (V27). */
    basis_override_reason: z.string().optional(),
    sources: z.array(slug).default([]),
    ...translatable('summary')
  })
);

export const RoleSchema = z.object({
  id: slug,
  title_en: z.string().min(2),
  title_fr: z.string().optional(),
  title_ar: z.string().optional(),
  institution: slug,
  authority: z.number().min(0).max(100),
  row: slug.optional(),
  summary: z.string().optional(),
  sources: z.array(slug).default([]),
  ...translatable('summary')
});

export const PersonSchema = withClaimEnvelope(
  'person',
  z.strictObject({
    id: slug,
    name_en: z.string().min(2),
    name_fr: z.string().optional(),
    name_ar: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    birth: z.string().optional(),
    death: z.string().optional(),
    birthplace: slug.optional(),
    nationality: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
    layers: z.array(Layer).min(1),
    tagline: z.string().optional(),
    summary: z.string().optional(),
    trajectory: z.array(z.string()).default([]),
    confidence: Confidence.default('B'),
    basis: Basis.optional(),
    verification: Verification.default('verified'),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** Why the authored basis overrides the grade-implied basis (V27). */
    basis_override_reason: z.string().optional(),
    disputes: z.array(DisputeSchema).default([]),
    review: ReviewSchema.optional(),
    notes: z.array(z.string()).default([]),
    sources: z.array(slug).default([]),
    ...translatable('tagline'),
    ...translatable('summary'),
    ...translatable('trajectory', 'list'),
    ...translatable('notes', 'list'),
    ...translatable('reasoning'),
    ...translatable('falsifiable_by')
  })
);

const dateToken = z
  .string()
  .regex(
    /^(?:~|<=|>=)?\d{4}(?:-\d{2}(?:-\d{2})?)?$|^(?:\?|ongoing|verified:\d{4}(?:-\d{2}(?:-\d{2})?)?)$/,
    'date token must be YYYY, YYYY-MM, YYYY-MM-DD, ~YYYY[-MM], <=YYYY[-MM], >=YYYY[-MM], ?, ongoing, or verified:...'
  );

export const PositionSchema = withClaimEnvelope(
  'position',
  z.strictObject({
    id: slug,
    role: slug,
    holder: slug,
    start: dateToken.optional(),
    end: dateToken.optional(),
    acting: z.boolean().default(false),
    predecessor: slug.nullable().optional(),
    supersedes: slug.optional(),
    confidence: Confidence.default('B'),
    basis: Basis.optional(),
    verification: Verification.default('verified'),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** Why the authored basis overrides the grade-implied basis (V27). */
    basis_override_reason: z.string().optional(),
    disputes: z.array(DisputeSchema).default([]),
    merged_into: slug.optional(),
    review: ReviewSchema.optional(),
    notes: z.array(z.string()).default([]),
    sources: z.array(slug).min(1, 'every position needs at least one source'),
    ...translatable('reasoning'),
    ...translatable('falsifiable_by'),
    ...translatable('notes', 'list')
  })
);

export const RelationshipSchema = withClaimEnvelope(
  'relationship',
  z.strictObject({
    id: slug,
    from: slug,
    to: slug,
    type: RelationshipType,
    subtype: z.string().optional(),
    start: dateToken.optional(),
    end: dateToken.optional(),
    description: z.string().min(4),
    confidence: Confidence,
    basis: Basis.optional(),
    verification: Verification.default('verified'),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** Why the authored basis overrides the grade-implied basis (V27). */
    basis_override_reason: z.string().optional(),
    disputes: z.array(DisputeSchema).default([]),
    merged_into: slug.optional(),
    supersedes: slug.optional(),
    review: ReviewSchema.optional(),
    sources: z.array(slug).default([]),
    ...translatable('description'),
    ...translatable('reasoning'),
    ...translatable('falsifiable_by'),
    notes: z.array(z.string()).default([]),
    ...translatable('notes', 'list'),
    equity: z
      .strictObject({
        pct: z.number().min(0).max(100),
        direct: z.boolean().default(true),
        beneficial: z.boolean().default(false),
        class: z.string().optional()
      })
      .optional(),
    finance: z
      .strictObject({
        amount: z.number().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        year: z.number().int().min(1900).max(2030)
      })
      .optional(),
    influence: z
      .strictObject({ channel: z.enum(INFLUENCE_CHANNELS), strength: z.number().min(0.3).max(1) })
      .optional()
  })
)
  .refine((r) => !(r.type === 'allegation' && r.sources.length === 0), {
    message: 'an allegation must carry a source'
  })
  .refine((r) => !r.influence || ['influence', 'reported-influence', 'advisory'].includes(r.type), {
    message: 'influence metadata only on influence-family edges'
  })
  .refine((r) => !(r.influence && !r.reasoning), {
    message: 'influence strength must state its reasoning'
  });

export const EventSchema = withClaimEnvelope(
  'event',
  z.strictObject({
    id: slug,
    date: dateToken,
    date_end: dateToken.optional(),
    title_en: z.string().min(3),
    title_fr: z.string().optional(),
    title_ar: z.string().optional(),
    category: z.enum([
      'political',
      'military',
      'security',
      'economic',
      'constitutional',
      'election',
      'protest',
      'legal',
      'award',
      'investigation',
      'media'
    ]),
    subcategory: z.string().optional(),
    location: z.array(slug).default([]),
    impact: z.strictObject({ layer: z.array(Layer).default([]) }).optional(),
    documents: z.array(z.string()).default([]),
    materials: z.array(z.string()).default([]),
    causes: z.array(slug).default([]),
    consequences: z.array(slug).default([]),
    rupture: z.boolean().default(false),
    summary: z.string().min(10),
    actors: z.array(slug).default([]),
    institutions: z.array(slug).default([]),
    confidence: Confidence.default('A'),
    basis: Basis.optional(),
    verification: Verification.default('verified'),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
    /** Why the authored basis overrides the grade-implied basis (V27). */
    basis_override_reason: z.string().optional(),
    contested: z.array(
      z.strictObject({ framing: z.string(), held_by: z.string(), source: slug.optional() })
    ).default([]),
    disputes: z.array(DisputeSchema).default([]),
    review: ReviewSchema.optional(),
    sources: z.array(slug).min(1, 'every event needs at least one source'),
    ...translatable('summary')
  })
);

export const EraSchema = z.object({
  id: slug,
  label_en: z.string().min(2),
  label_fr: z.string().optional(),
  label_ar: z.string().optional(),
  start: dateToken,
  end: dateToken,
  thesis: z.string().min(10),
  formula: z.string().optional(),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  sources: z.array(slug).default([]),
  confidence: Confidence.optional(),
  verification: Verification.optional(),
  attributed_to: z.string().optional(),
  reasoning: z.string().optional(),
  falsifiable_by: z.string().optional(),
  ...translatable('thesis'),
  ...translatable('reasoning'),
  ...translatable('falsifiable_by')
});

export type Source = z.infer<typeof SourceSchema>;
export type Institution = z.infer<typeof InstitutionSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type PositionRec = z.infer<typeof PositionSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type EventRec = z.infer<typeof EventSchema>;
export type Era = z.infer<typeof EraSchema>;
export type Dispute = z.infer<typeof DisputeSchema>;
export type Review = z.infer<typeof ReviewSchema>;
