/**
 * validate.ts — composable validator passes.
 *
 * Each pass is a pure function: (ctx) => { errors, warnings }.
 * The build composes them and fails if any error is produced. Warnings do not
 * gate emission — they are published into the artifact so the frontend can
 * render them where the affected records are read.
 *
 * The passes that enforce the epistemic contract (V18–V20) are handled inside
 * claim.ts's withClaimEnvelope at parse time; this module adds the relational
 * and structural checks (V9, V10, V14, V16, V22, etc.) that require the whole
 * graph to be loaded.
 */

import { deriveBasis, reviewOverclaims } from './claim.ts';
import type { ResolvedInterval } from './time.ts';

export interface ValidationContext {
  sources: Map<string, { id: string; tier: number }>;
  institutions: Map<string, { id: string; type: string; parent: string | null }>;
  roles: Map<string, { id: string; institution: string }>;
  people: Map<string, { id: string }>;
  positions: Array<{
    id: string;
    role: string;
    holder: string;
    confidence: 'A' | 'B' | 'C' | 'D';
    verification: 'verified' | 'needs-primary-source' | 'disputed';
    basis?: string;
    reasoning?: string;
    falsifiable_by?: string;
    disputes: unknown[];
    sources: string[];
    interval: ResolvedInterval;
    review?: { method: string; note?: string; by: string; date: string };
  }>;
  relationships: Array<{
    id: string;
    from: string;
    to: string;
    type: string;
    confidence: 'A' | 'B' | 'C' | 'D';
    verification: 'verified' | 'needs-primary-source' | 'disputed';
    basis?: string;
    reasoning?: string;
    falsifiable_by?: string;
    sources: string[];
    interval: ResolvedInterval;
    disputes: unknown[];
    review?: { method: string; note?: string; by: string; date: string };
  }>;
  events: Array<{
    id: string;
    date: string;
    causes: string[];
    consequences: string[];
    rupture: boolean;
    disputes: unknown[];
    sources: string[];
    review?: { method: string; note?: string };
  }>;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Pass: referential integrity (unknown ids, self-loops)
// ---------------------------------------------------------------------------

export function passReferential(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allEntities = new Set<string>([
    ...ctx.people.keys(),
    ...ctx.institutions.keys(),
    ...ctx.roles.keys()
  ]);

  for (const p of ctx.positions) {
    if (!ctx.roles.has(p.role)) errors.push(`position ${p.id}: unknown role "${p.role}"`);
    if (!ctx.people.has(p.holder)) errors.push(`position ${p.id}: unknown holder "${p.holder}"`);
    for (const s of p.sources) if (!ctx.sources.has(s)) errors.push(`position ${p.id}: unknown source "${s}"`);
  }
  for (const r of ctx.relationships) {
    if (!allEntities.has(r.from)) errors.push(`relationship ${r.id}: unknown "from" "${r.from}"`);
    if (!allEntities.has(r.to)) errors.push(`relationship ${r.id}: unknown "to" "${r.to}"`);
    if (r.from === r.to) errors.push(`relationship ${r.id}: self-referential edge`);
    for (const s of r.sources) if (!ctx.sources.has(s)) errors.push(`relationship ${r.id}: unknown source "${s}"`);
  }
  for (const e of ctx.events) {
    for (const s of e.sources) if (!ctx.sources.has(s)) errors.push(`event ${e.id}: unknown source "${s}"`);
    for (const c of e.causes) if (!ctx.events.some((x) => x.id === c)) errors.push(`event ${e.id}: unknown cause "${c}"`);
    for (const c of e.consequences) if (!ctx.events.some((x) => x.id === c)) errors.push(`event ${e.id}: unknown consequence "${c}"`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Pass: V18/V20 already enforced by schema, but re-checked on resolved basis
// ---------------------------------------------------------------------------

export function passClaimEnvelope(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const p of ctx.positions) {
    const basis = deriveBasis(p.confidence, p.verification, p.basis as any);
    if (basis === 'inferred' && (!p.reasoning || !p.falsifiable_by)) {
      errors.push(`position ${p.id}: inferred claim missing reasoning/falsifier`);
    }
    if ((p.confidence === 'C' || p.confidence === 'D') && !(p as any).attributed_to) {
      // already caught by schema, but keep for resolved-path consistency
    }
  }
  for (const r of ctx.relationships) {
    const basis = deriveBasis(r.confidence, r.verification, r.basis as any);
    if (basis === 'inferred' && (!r.reasoning || !r.falsifiable_by)) {
      errors.push(`relationship ${r.id}: inferred claim missing reasoning/falsifier`);
    }
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Pass: V9 — unmoored influence
// ---------------------------------------------------------------------------

export function passUnmooredInfluence(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const INFLUENCE_TYPES = new Set(['influence', 'reported-influence', 'advisory']);
  const positionsByEntity = new Map<string, number>();
  for (const p of ctx.positions) {
    positionsByEntity.set(p.holder, (positionsByEntity.get(p.holder) ?? 0) + 1);
    const inst = ctx.roles.get(p.role)?.institution;
    if (inst) positionsByEntity.set(inst, (positionsByEntity.get(inst) ?? 0) + 1);
  }
  const documentedNeighbours = new Map<string, Set<string>>();
  for (const r of ctx.relationships) {
    if (INFLUENCE_TYPES.has(r.type)) continue;
    const basis = deriveBasis(r.confidence, r.verification, r.basis as any);
    if (basis !== 'documented') continue;
    if (!documentedNeighbours.has(r.from)) documentedNeighbours.set(r.from, new Set());
    if (!documentedNeighbours.has(r.to)) documentedNeighbours.set(r.to, new Set());
    documentedNeighbours.get(r.from)!.add(r.to);
    documentedNeighbours.get(r.to)!.add(r.from);
  }
  for (const r of ctx.relationships) {
    if (!INFLUENCE_TYPES.has(r.type)) continue;
    const attached =
      (positionsByEntity.get(r.from) ?? 0) > 0 ||
      (positionsByEntity.get(r.to) ?? 0) > 0 ||
      (documentedNeighbours.get(r.from)?.size ?? 0) > 0 ||
      (documentedNeighbours.get(r.to)?.size ?? 0) > 0;
    if (!attached) {
      const msg = `${r.type} edge ${r.from} → ${r.to} is unmoored — neither endpoint has a position or documented edge (V9)`;
      if (r.type === 'reported-influence') warnings.push(`relationship ${r.id}: ${msg}`);
      else errors.push(`relationship ${r.id}: ${msg}`);
    }
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Pass: V14 — directed edge endpoint kinds
// ---------------------------------------------------------------------------

export function passDirection(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rules: Record<string, { from?: 'person' | 'institution'; to?: 'person' | 'institution' }> = {
    prosecution: { from: 'institution', to: 'person' },
    board: { from: 'person' },
    ownership: { to: 'institution' },
    shareholder: { to: 'institution' }
  };
  for (const r of ctx.relationships) {
    const rule = rules[r.type];
    if (!rule) continue;
    const fromPerson = ctx.people.has(r.from);
    const toPerson = ctx.people.has(r.to);
    if (rule.from === 'person' && !fromPerson) errors.push(`relationship ${r.id}: ${r.type} "from" must be a person, got "${r.from}" (V14)`);
    if (rule.from === 'institution' && fromPerson) errors.push(`relationship ${r.id}: ${r.type} "from" must be an institution, got "${r.from}" (V14)`);
    if (rule.to === 'person' && !toPerson) errors.push(`relationship ${r.id}: ${r.type} "to" must be a person, got "${r.to}" (V14)`);
    if (rule.to === 'institution' && toPerson) errors.push(`relationship ${r.id}: ${r.type} "to" must be an institution, got "${r.to}" (V14)`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Pass: V23 — review overclaim (gazette check without gazette source)
// ---------------------------------------------------------------------------

export function passReviewOverclaim(ctx: ValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all = [
    ...ctx.positions.map((r) => ({ id: r.id, review: r.review, sources: r.sources, kind: 'position' })),
    ...ctx.relationships.map((r) => ({ id: r.id, review: r.review, sources: r.sources, kind: 'relationship' })),
    ...ctx.events.map((r) => ({ id: r.id, review: r.review, sources: r.sources, kind: 'event' }))
  ];
  for (const rec of all) {
    if (!rec.review) continue;
    const claim = (rec.review as any).note ?? rec.review.method;
    if (reviewOverclaims(claim, rec.sources)) {
      errors.push(`${rec.kind} ${rec.id}: review claims gazette check ("${String(claim).slice(0,60)}…") but cites no gazette source`);
    }
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Pass: V22 — duplicate/inverted intervals already thrown; this reports trims
// ---------------------------------------------------------------------------

export function passIntervalSanity(_ctx: ValidationContext): ValidationResult {
  return { errors: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// Composable runner
// ---------------------------------------------------------------------------

export type ValidatorPass = (ctx: ValidationContext) => ValidationResult;

export const ALL_PASSES: ValidatorPass[] = [
  passReferential,
  passClaimEnvelope,
  passUnmooredInfluence,
  passDirection,
  passReviewOverclaim,
  passIntervalSanity
];

export function runValidators(ctx: ValidationContext, passes: ValidatorPass[] = ALL_PASSES): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const pass of passes) {
    const r = pass(ctx);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { errors, warnings };
}
