/**
 * engine.ts — the one entry point: createEngine(deployment).
 *
 * An engine holds its whole configuration. Two engines in one process do not
 * see each other, because nothing here is module state: the deployment arrives
 * as an argument and everything below closes over it.
 *
 * Slice 0 builds the pieces this slice moves: the time model and the claim
 * envelope. The rest of the interface is present and throws, so a caller meets
 * a named wall, not an undefined function.
 */

import type { z } from 'zod';
import {
  createTime,
  type ResolvedInterval,
  type Time,
  type TimeParameters
} from './kernel/time.ts';
import {
  Basis,
  Confidence,
  Verification,
  deriveBasis,
  isBasisUpgrade,
  type BasisValue,
  type ConfidenceValue,
  type VerificationValue
} from './kernel/basis.ts';
import {
  REQUIRED_SOURCE_KINDS,
  nonBlank,
  slug,
  withClaimEnvelope as envelopeBuilder,
  type ExceptionSource
} from './kernel/envelope.ts';
import {
  DisputeSchema,
  ReviewSchema,
  reviewOverclaims as reviewOverclaimsIn,
  type GazetteVocabulary
} from './kernel/review.ts';
import type { EnvelopeExceptions, ExceptionRegister } from './kernel/exceptions.ts';

export type { ResolvedInterval, Time, TimeParameters };
export type { BasisValue, ConfidenceValue, VerificationValue };
export type { EnvelopeExceptions, ExceptionRegister, ExceptionSource };

// ---------------------------------------------------------------------------------------------
// Findings, rules, the pipeline
// ---------------------------------------------------------------------------------------------

/** One finding from one rule about one record. */
export interface Finding {
  rule: string;
  severity: 'error' | 'warning';
  record?: { kind: string; id: string };
  message: string;
}

/**
 * A validator. `needs` says which stage it runs in: 'parsed' rules see records
 * as authored, 'resolved' rules also see intervals and derived basis.
 */
export interface Rule<Ctx = unknown> {
  id: string;
  title: string;
  layer: 'kernel' | 'atlas' | 'deployment';
  severity: 'error' | 'warning';
  needs: 'parsed' | 'resolved';
  run(ctx: Ctx): Finding[];
}

/** Splicer. Moves upstream from deeptunisia scripts/emit.ts. */
export interface Splicer {
  applyEdit(fileText: string, target: unknown, edit: unknown): { text: string; splice: unknown };
  assertOnlyTargetChanged(before: string, after: string, target: unknown): void;
}

/** Canonical bytes and the dataset hash. Moves upstream from scripts/canonical.ts. */
export interface Canonical {
  project(dataset: unknown, opts?: { drop?: string[] }): unknown;
  hash(dataset: unknown): string;
}

/** Records as loaded from YAML, keyed by kind. parse() is what types them. */
export type RawDataset = Readonly<Record<string, readonly unknown[]>>;
export type ParsedDataset = Readonly<Record<string, readonly { id: string }[]>>;
export interface ResolvedDataset {
  records: ParsedDataset;
  intervals: ReadonlyMap<string, ResolvedInterval>;
  basis: ReadonlyMap<string, BasisValue>;
  index: ReadonlyMap<string, { kind: string; record: { id: string } }>;
}

// ---------------------------------------------------------------------------------------------
// Deployment: everything that is about one country or one subject
// ---------------------------------------------------------------------------------------------

export interface KindDefinition {
  kind: string;
  file: string;
  schema: z.ZodType;
  bearsClaims: boolean;
  layer: 'kernel' | 'atlas' | 'deployment';
}

export interface Deployment {
  name: string;
  time: TimeParameters;

  /** Languages prose is translated into. */
  translatedLocales: readonly string[];
  /** Languages a source may be written in. */
  sourceLanguages: readonly string[];

  /** How a primary source is recognised. */
  gazette: GazetteVocabulary;
  registry: { label: string; idLabel: string; registries: readonly string[] };
  bbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };

  /** Labels a review may be signed with, beyond a person's handle. */
  reviewerLabels: readonly string[];

  /** Scoring parameters used by derived indexes. */
  index: { discount: Record<BasisValue, number> };

  /** Vocabulary. Each list starts from the atlas default and may add or drop entries. */
  vocabulary: {
    layers: readonly string[];
    institutionTypes: readonly string[];
    relationshipTypes: readonly string[];
    edgeDirection: Readonly<Record<string, 'directed' | 'symmetric' | 'contextual'>>;
    influenceChannels: readonly string[];
    agreementKinds: readonly string[];
    placeKinds: readonly string[];
    regionKinds: readonly string[];
  };

  /** Name-matcher word lists per script. */
  matcher: {
    particles: readonly string[];
    functionWords: readonly string[];
    splittablePrefixes: readonly string[];
  };

  /** Record kinds only this deployment has. */
  extraKinds?: readonly KindDefinition[];
  /** Rules only this deployment has. */
  extraRules?: readonly Rule[];
}

// ---------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------

/** The envelope helpers of one engine, wired to that engine's deployment. */
export interface Envelope {
  readonly exceptions: EnvelopeExceptions;
  nonBlank(v: unknown, min?: number): boolean;
  /**
   * The kernel builder, unchanged. It is exposed here so a caller reaches the
   * envelope through the engine, and the deployment reaches it through the
   * gazette check; the generic is kept so record types stay inferred.
   */
  withClaimEnvelope: typeof envelopeBuilder;
  deriveBasis(
    confidence: ConfidenceValue,
    verification: VerificationValue,
    explicit?: BasisValue
  ): BasisValue;
  isBasisUpgrade(authored: BasisValue, derived: BasisValue): boolean;
  reviewOverclaims(method: string | undefined, sources: readonly string[]): boolean;
  readonly Confidence: typeof Confidence;
  readonly Basis: typeof Basis;
  readonly Verification: typeof Verification;
  readonly ReviewSchema: typeof ReviewSchema;
  readonly DisputeSchema: typeof DisputeSchema;
  readonly slug: typeof slug;
  readonly requiredSourceKinds: ReadonlySet<string>;
}

export interface Engine {
  readonly deployment: Deployment;
  readonly time: Time;
  readonly envelope: Envelope;
  readonly kinds: ReadonlyMap<string, KindDefinition>;
  readonly rules: readonly Rule[];
  readonly splicer: Splicer;
  readonly canonical: Canonical;

  parse(raw: RawDataset, exceptions: ExceptionRegister): { records: ParsedDataset; findings: Finding[] };
  resolve(records: ParsedDataset): ResolvedDataset;
  validate(resolved: ResolvedDataset): Finding[];
  check(raw: RawDataset, exceptions: ExceptionRegister): { ok: boolean; findings: Finding[]; resolved?: ResolvedDataset };
  buildMatcher(entities: readonly unknown[], opts?: unknown): unknown;
}

function notBuilt(part: string, slice: number): never {
  throw new Error(`${part}: not built yet (slice ${slice})`);
}

function checkList(name: string, list: readonly string[] | undefined): void {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`deployment: ${name} must be a non-empty list`);
  }
  if (new Set(list).size !== list.length) {
    throw new Error(`deployment: ${name} has a duplicate entry`);
  }
}

const DIRECTIONS = new Set(['directed', 'symmetric', 'contextual']);
const BASIS_VALUES: readonly BasisValue[] = ['documented', 'reported', 'inferred', 'unsubstantiated'];

function validateDeployment(d: Deployment): void {
  if (typeof d?.name !== 'string' || !nonBlank(d.name, 2)) {
    throw new Error('deployment: name must be at least 2 non-blank characters');
  }

  checkList('translatedLocales', d.translatedLocales);
  checkList('sourceLanguages', d.sourceLanguages);
  checkList('gazette.vocabulary', d.gazette?.vocabulary);
  checkList('gazette.sourcePrefixes', d.gazette?.sourcePrefixes);
  checkList('registry.registries', d.registry?.registries);

  const v = d.vocabulary;
  checkList('vocabulary.layers', v?.layers);
  checkList('vocabulary.institutionTypes', v?.institutionTypes);
  checkList('vocabulary.relationshipTypes', v?.relationshipTypes);
  checkList('vocabulary.influenceChannels', v?.influenceChannels);
  checkList('vocabulary.agreementKinds', v?.agreementKinds);
  checkList('vocabulary.placeKinds', v?.placeKinds);
  checkList('vocabulary.regionKinds', v?.regionKinds);

  const types = new Set(v.relationshipTypes);
  const directed = Object.keys(v.edgeDirection ?? {});
  for (const type of v.relationshipTypes) {
    const dir = v.edgeDirection?.[type];
    if (!dir) throw new Error(`deployment: edgeDirection has no entry for relationship type "${type}"`);
    if (!DIRECTIONS.has(dir)) {
      throw new Error(`deployment: edgeDirection["${type}"] is "${dir}", not one of directed, symmetric, contextual`);
    }
  }
  for (const key of directed) {
    if (!types.has(key)) {
      throw new Error(`deployment: edgeDirection names "${key}", which is not a relationship type`);
    }
  }

  for (const list of ['particles', 'functionWords', 'splittablePrefixes'] as const) {
    const words = d.matcher?.[list];
    if (!Array.isArray(words)) throw new Error(`deployment: matcher.${list} must be a list`);
    if (new Set(words).size !== words.length) {
      throw new Error(`deployment: matcher.${list} has a duplicate entry`);
    }
  }

  if (!Array.isArray(d.reviewerLabels)) {
    throw new Error('deployment: reviewerLabels must be a list (it may be empty)');
  }

  for (const basis of BASIS_VALUES) {
    const weight = d.index?.discount?.[basis];
    if (typeof weight !== 'number' || !(weight >= 0) || !(weight <= 1)) {
      throw new Error(`deployment: index.discount.${basis} must be a number between 0 and 1`);
    }
  }

  if (d.extraKinds) {
    const seen = new Set<string>();
    for (const k of d.extraKinds) {
      if (!nonBlank(k.kind)) throw new Error('deployment: extraKinds entries need a kind name');
      if (seen.has(k.kind)) throw new Error(`deployment: extraKinds repeats "${k.kind}"`);
      seen.add(k.kind);
    }
  }
  if (d.extraRules) {
    const seen = new Set<string>();
    for (const r of d.extraRules) {
      if (!nonBlank(r.id)) throw new Error('deployment: extraRules entries need an id');
      if (seen.has(r.id)) throw new Error(`deployment: extraRules repeats "${r.id}"`);
      seen.add(r.id);
    }
  }
}

/**
 * The only way to get an Engine. Validates the deployment (a malformed one is a
 * programming error, not a data finding) and returns self-contained functions.
 */
export function createEngine(deployment: Deployment): Engine {
  validateDeployment(deployment);

  const time = createTime(deployment.time);

  const envelope: Envelope = Object.freeze({
    exceptions: Object.freeze({}) as EnvelopeExceptions,
    nonBlank,
    withClaimEnvelope: envelopeBuilder,
    deriveBasis,
    isBasisUpgrade,
    reviewOverclaims: (method: string | undefined, sources: readonly string[]) =>
      reviewOverclaimsIn(deployment.gazette, method, sources),
    Confidence,
    Basis,
    Verification,
    ReviewSchema,
    DisputeSchema,
    slug,
    requiredSourceKinds: REQUIRED_SOURCE_KINDS
  });

  function parse(): never {
    return notBuilt('parse', 2);
  }
  function resolve(): never {
    return notBuilt('resolve', 4);
  }
  function validate(): never {
    return notBuilt('validate', 4);
  }

  const engine: Engine = {
    deployment,
    time,
    envelope,
    get kinds(): ReadonlyMap<string, KindDefinition> {
      return notBuilt('kinds', 3);
    },
    get rules(): readonly Rule[] {
      return notBuilt('rules', 4);
    },
    get splicer(): Splicer {
      return notBuilt('splicer', 1);
    },
    get canonical(): Canonical {
      return notBuilt('canonical', 1);
    },
    parse,
    resolve,
    validate,
    check() {
      parse();
      resolve();
      validate();
      return { ok: false, findings: [] };
    },
    buildMatcher(): never {
      return notBuilt('buildMatcher', 5);
    }
  };

  return Object.freeze(engine);
}

/** The atlas defaults a deployment starts from. */
export { atlasDefaults } from './atlas/vocabulary.ts';
export { createTime };
