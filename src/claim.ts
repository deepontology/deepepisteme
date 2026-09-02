/**
 * claim.ts — the evidence envelope.
 *
 * Every claim-bearing record carries the same nine fields:
 *   confidence, basis (derived), verification, attributed_to,
 *   reasoning, falsifiable_by, disputes, review, sources
 *
 * Basis answers "what KIND of claim is this?" — not "how strong is it?".
 * A reasoned inference and a thinly-sourced report are both weak, but weak
 * in completely different ways. Collapsing them is how a project quietly
 * becomes a rumour mill.
 *
 *   documented       An official record states this.
 *   reported         Credible publications report it; attributed, not verified.
 *   inferred         Nobody states this directly; reasoned from structure.
 *   unsubstantiated  Circulates without reliable evidence. Kept, not deleted.
 */

import { z } from 'zod';
import { getParameters } from './config.ts';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids must be lowercase kebab-case');

export const Confidence = z.enum(['A', 'B', 'C', 'D']);
export const Basis = z.enum(['documented', 'reported', 'inferred', 'unsubstantiated']);
export const Verification = z.enum(['verified', 'needs-primary-source', 'disputed']);
export const TranslatedBy = z.enum(['machine', 'model-reviewed', 'machine-reviewed', 'human']);
export const ReviewMethod = z.enum(['source-check', 'dedup', 'attribute', 'accept-reject', 'judge']);

export type ConfidenceValue = z.infer<typeof Confidence>;
export type BasisValue = z.infer<typeof Basis>;

export const ReviewSchema = z.object({
  by: z.string().min(2),
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

export const DisputeSchema = z.object({
  claim: z.string().min(3),
  held_by: z.string().min(2),
  source: slug.optional(),
  assessment: z.string().optional(),
  status: z.enum(['open', 'adopted', 'rejected']).optional(),
  resolved_by: z.string().optional(),
  resolved_at: z.string().optional()
});

export function deriveBasis(
  confidence: 'A' | 'B' | 'C' | 'D',
  verification: 'verified' | 'needs-primary-source' | 'disputed',
  explicit?: 'documented' | 'reported' | 'inferred' | 'unsubstantiated'
): BasisValue {
  if (explicit) return explicit;
  if (confidence === 'A') return 'documented';
  if (confidence === 'D') return 'unsubstantiated';
  if (confidence === 'C' && verification === 'needs-primary-source') return 'inferred';
  return 'reported';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A review note may not claim a gazette verification without a gazette source.
 * Vocabulary and source prefixes come from data/parameters.yaml.
 */
export function reviewOverclaims(method: string | undefined, sources: string[]): boolean {
  const gazette = getParameters().jurisdiction.gazette;
  const claimsGazette = new RegExp(`\\b(${gazette.vocabulary.map(escapeRegex).join('|')})\\b`, 'i');
  const gazetteSource = new RegExp(`^(${gazette.sourcePrefixes.map(escapeRegex).join('|')})`);
  if (!method || !claimsGazette.test(method)) return false;
  if (/\bnot\b[^.]{0,40}\b(verified|checked)\b/i.test(method)) return false;
  return !sources.some((s) => gazetteSource.test(s));
}

export const TRANSLATED_LOCALES = ['fr', 'ar'] as const;
export const TRANSLATION_TIERS = ['machine', 'model-reviewed', 'machine-reviewed', 'human'] as const;

export function translatable(name: string, kind: 'string' | 'list' = 'string') {
  const value = kind === 'list' ? z.array(z.string()) : z.string();
  return Object.fromEntries(
    TRANSLATED_LOCALES.flatMap((loc) => [
      [`${name}_${loc}`, value.optional()],
      [`${name}_${loc}_by`, TranslatedBy.optional()]
    ])
  ) as Record<string, z.ZodTypeAny>;
}

/**
 * Shared claim envelope — nine fields, applied to every claim-bearing kind.
 * V18/V20 are enforced here so no future kind can forget them.
 */
const claimFields = {
  confidence: Confidence.default('B'),
  basis: Basis.optional(),
  verification: Verification.default('verified'),
  attributed_to: z.string().optional(),
  reasoning: z.string().optional(),
  falsifiable_by: z.string().optional(),
  disputes: z.array(DisputeSchema).default([]),
  review: ReviewSchema.optional(),
  sources: z.array(slug).min(1, 'every claim record needs at least one source')
};

export function withClaimEnvelope<S extends z.ZodObject<z.ZodRawShape>>(schema: S) {
  return schema
    .refine((r: any) => !((r.confidence === 'C' || r.confidence === 'D') && !r.attributed_to), {
      message: 'grade C/D claims must name who is making the claim (attributed_to)'
    })
    .refine(
      (r: any) =>
        !(
          deriveBasis(r.confidence, r.verification, r.basis) === 'inferred' &&
          (!r.reasoning || !r.falsifiable_by)
        ),
      { message: 'an inferred claim must state its reasoning and what would falsify it' }
    )
    .refine(
      (r: any) =>
        !(
          deriveBasis(r.confidence, r.verification, r.basis) === 'unsubstantiated' &&
          !r.attributed_to
        ),
      { message: 'an unsubstantiated claim must name where the claim circulates' }
    );
}

// ---------------------------------------------------------------------------
// Re-exports used by build.ts: common schemas
// ---------------------------------------------------------------------------

export const SourceSchema = z.object({
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

export const InstitutionType = z.enum([
  'presidency',
  'government',
  'ministry',
  'military',
  'police',
  'party',
  'company',
  'association',
  'media',
  'legislature',
  'judiciary',
  'bank',
  'state-enterprise',
  'holding',
  'ngo',
  'regulator',
  'university'
]);

export const Layer = z.enum([
  'security',
  'political',
  'economic',
  'media',
  'judicial',
  'civil',
  'foreign'
]);

export const InstitutionSchema = withClaimEnvelope(
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
    active: z.object({ start: z.string().optional(), end: z.string().optional() }).default({}),
    order: z.number().int().default(100),
    summary: z.string().optional(),
    confidence: Confidence.default('A'),
    basis: Basis.optional(),
    verification: Verification.default('verified'),
    attributed_to: z.string().optional(),
    reasoning: z.string().optional(),
    falsifiable_by: z.string().optional(),
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

const intervalSpec = z.object({ start: dateToken.optional(), end: dateToken.optional() });

export const PositionSchema = withClaimEnvelope(
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

export const RelationshipType = z.enum([
  'institutional',
  'appointment',
  'succession',
  'family',
  'business',
  'party',
  'security',
  'funding',
  'diplomatic',
  'political-alliance',
  'political-conflict',
  'prosecution',
  'reported-influence',
  'allegation',
  'dismissal',
  'ownership',
  'board',
  'shareholder',
  'sponsorship',
  'partnership',
  'franchise',
  'oversight',
  'regulatory-authority',
  'licence',
  'sanction',
  'coalition',
  'endorsement',
  'candidate-campaign',
  'influence',
  'advisory'
]);

export type DirectionKind = 'directed' | 'symmetric' | 'contextual';
export const EDGE_DIRECTION: Record<z.infer<typeof RelationshipType>, DirectionKind> = {
  institutional: 'contextual',
  appointment: 'directed',
  succession: 'directed',
  dismissal: 'directed',
  family: 'symmetric',
  business: 'contextual',
  party: 'contextual',
  security: 'contextual',
  funding: 'directed',
  diplomatic: 'symmetric',
  'political-alliance': 'symmetric',
  'political-conflict': 'symmetric',
  prosecution: 'directed',
  'reported-influence': 'contextual',
  allegation: 'contextual',
  ownership: 'directed',
  board: 'directed',
  shareholder: 'directed',
  sponsorship: 'directed',
  partnership: 'symmetric',
  franchise: 'directed',
  oversight: 'directed',
  'regulatory-authority': 'directed',
  licence: 'directed',
  sanction: 'directed',
  coalition: 'symmetric',
  endorsement: 'directed',
  'candidate-campaign': 'directed',
  influence: 'directed',
  advisory: 'directed'
};

export const INFLUENCE_CHANNELS = [
  'appointment',
  'advice-relationship',
  'money',
  'publicity',
  'marriage',
  'secret',
  ''
] as const;

export const RelationshipSchema = withClaimEnvelope(
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
      .object({
        pct: z.number().min(0).max(100),
        direct: z.boolean().default(true),
        beneficial: z.boolean().default(false),
        class: z.string().optional()
      })
      .optional(),
    finance: z
      .object({
        amount: z.number().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        year: z.number().int().min(1900).max(2030)
      })
      .optional(),
    influence: z
      .object({ channel: z.enum(INFLUENCE_CHANNELS), strength: z.number().min(0.3).max(1) })
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
    impact: z.object({ layer: z.array(Layer).default([]) }).optional(),
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
    contested: z.array(z.object({ framing: z.string(), held_by: z.string(), source: slug.optional() })).default([]),
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
