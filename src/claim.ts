/**
 * claim.ts: the v0.1 evidence module, now a view of one engine.
 *
 * The envelope itself (grades, basis, reviews, disputes, the exception sets)
 * and the power-map vocabulary live in kernel/ and atlas/. This module keeps
 * the old import path working for the build and test gates that still import
 * it: it re-exports those pieces and re-exports the seven power-map kinds
 * from src/atlas/kinds/, wrapped with the exception getter this module has
 * always held.
 *
 * removed in slice 3 (the kinds already moved; the module stays while the
 * v0.1 build and test gates still import it)
 */

import { z } from 'zod';
import {
  Basis,
  Confidence,
  ConfidenceValue,
  Verification,
  ReviewMethod,
  TranslatedBy,
  createReviewSchema,
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
import {
  eraSchema,
  eventSchema,
  institutionSchema,
  personSchema,
  positionSchema,
  relationshipRefines,
  relationshipSchema,
  roleSchema,
  type AtlasLiterals
} from './atlas/kinds/index.ts';

export {
  Basis,
  Confidence,
  Verification,
  ReviewMethod,
  TranslatedBy,
  DisputeSchema,
  deriveBasis,
  isBasisUpgrade,
  nonBlank,
  REQUIRED_SOURCE_KINDS,
  TRANSLATION_TIERS
};
export type { BasisValue, ConfidenceValue };

/** The strict review object, built for the default engine's reviewer labels. */
export const ReviewSchema = createReviewSchema(legacyEngine.deployment.reviewerLabels);
export type Review = z.infer<typeof ReviewSchema>;

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

// ---------------------------------------------------------------------------------------------
// The seven power-map kinds. The schemas live in src/atlas/kinds/ now, built
// from the same literals the engine's kind register builds them from; this
// module only re-exports them under the v0.1 names with the v0.1 exception
// getter, so the old import paths keep answering as before. The claim-bearing
// ones are wrapped here because a module-level schema cannot be handed a
// per-call register.
// ---------------------------------------------------------------------------------------------

/** The default engine's atlas literals, so these schemas and the register agree. */
const atlasLiterals: AtlasLiterals = {
  name: legacyEngine.deployment.name,
  translatedLocales: TRANSLATED_LOCALES,
  review: ReviewSchema,
  institutionTypes: legacyEngine.deployment.vocabulary.institutionTypes,
  layers: legacyEngine.deployment.vocabulary.layers,
  relationshipTypes: legacyEngine.deployment.vocabulary.relationshipTypes,
  influenceChannels: legacyEngine.deployment.vocabulary.influenceChannels,
  agreementKinds: legacyEngine.deployment.vocabulary.agreementKinds,
  placeKinds: legacyEngine.deployment.vocabulary.placeKinds,
  registries: legacyEngine.deployment.registry.registries,
  bbox: legacyEngine.deployment.bbox
};

export const InstitutionSchema = withClaimEnvelope('institution', institutionSchema(atlasLiterals));

export const RoleSchema = roleSchema(atlasLiterals);

export const PersonSchema = withClaimEnvelope('person', personSchema(atlasLiterals));

export const PositionSchema = withClaimEnvelope('position', positionSchema(atlasLiterals));

export const RelationshipSchema = relationshipRefines(
  withClaimEnvelope('relationship', relationshipSchema(atlasLiterals))
);

export const EventSchema = withClaimEnvelope('event', eventSchema(atlasLiterals));

export const EraSchema = eraSchema(atlasLiterals);

export type Source = z.infer<typeof SourceSchema>;
export type Institution = z.infer<typeof InstitutionSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type PositionRec = z.infer<typeof PositionSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type EventRec = z.infer<typeof EventSchema>;
export type Era = z.infer<typeof EraSchema>;
export type Dispute = z.infer<typeof DisputeSchema>;
