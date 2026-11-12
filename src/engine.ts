/**
 * engine.ts: the one entry point: createEngine(deployment).
 *
 * An engine holds its whole configuration. Two engines in one process do not
 * see each other, because nothing here is module state: the deployment arrives
 * as an argument and everything below closes over it.
 *
 * Slice 0 builds the pieces it moves: the time model and the claim envelope.
 * Slice 1 adds the canonical projection and the splicer. Slice 2 adds the kind
 * register, parse() and the first three rules. The rest of the interface is
 * present and throws, so a caller meets a named wall, not an undefined
 * function.
 */

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
  SCHEMA_RULE,
  issueRule,
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
import {
  NO_EXCEPTIONS,
  convertRegister,
  type EnvelopeExceptions,
  type ExceptionRegister
} from './kernel/exceptions.ts';
import {
  KERNEL_KIND_NAMES,
  createKernelKinds,
  envelopedSchema,
  objectSchemaOf,
  type KindDefinition,
  type KindLiterals
} from './kernel/kinds.ts';
import {
  KERNEL_RULES,
  type Finding,
  type ParsedRecords,
  type Rule,
  type RuleContext
} from './kernel/rules.ts';
import { createSplicer, type Splicer } from './kernel/splicer.ts';
import { hash as canonicalHash, project as canonicalProject, type CanonicalOptions } from './kernel/canonical.ts';

export type { ResolvedInterval, Time, TimeParameters };
export type { BasisValue, ConfidenceValue, VerificationValue };
export type { EnvelopeExceptions, ExceptionRegister, ExceptionSource };
export type { KindDefinition } from './kernel/kinds.ts';
export type { Finding, Rule, RuleContext } from './kernel/rules.ts';

// ---------------------------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------------------------

/**
 * Records as loaded from YAML, keyed by kind. parse() is what types them.
 * ParsedDataset carries an entry for every registered kind, empty when the
 * dataset has no records of it.
 */
export type RawDataset = Readonly<Record<string, readonly unknown[]>>;
export type ParsedDataset = ParsedRecords;
export interface ResolvedDataset {
  records: ParsedDataset;
  intervals: ReadonlyMap<string, ResolvedInterval>;
  basis: ReadonlyMap<string, BasisValue>;
  index: ReadonlyMap<string, { kind: string; record: { id: string } }>;
}

/**
 * Splicer. Moves upstream from deeptunisia scripts/emit.ts: seven edit
 * operations and the self-check that the rest of the file did not move. The
 * target travels inside the edit, so a call is `applyEdit(text, edit)`.
 */
export type { Edit, EmitResult, Records, Splice, Splicer, Target } from './kernel/splicer.ts';

/**
 * Canonical bytes and the dataset hash. Moves upstream from scripts/canonical.ts.
 * `drop` names the fields a deployment emits but the hash must ignore, so the
 * one hash is reachable without a branch in the kernel.
 */
export interface Canonical {
  project(dataset: unknown, opts?: CanonicalOptions): unknown;
  hash(dataset: unknown, opts?: CanonicalOptions): string;
}
export type { CanonicalOptions };

// ---------------------------------------------------------------------------------------------
// Deployment: everything that is about one country or one subject
// ---------------------------------------------------------------------------------------------

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

  parse(raw: RawDataset, exceptions?: ExceptionRegister): { records: ParsedDataset; findings: Finding[] };
  resolve(records: ParsedDataset): ResolvedDataset;
  validate(resolved: ResolvedDataset): Finding[];
  check(raw: RawDataset, exceptions?: ExceptionRegister): { ok: boolean; findings: Finding[]; resolved?: ResolvedDataset };
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
  if (!d.sourceLanguages.includes('en')) {
    throw new Error('deployment: sourceLanguages must include "en", the default the source kind applies');
  }
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
      if ((KERNEL_KIND_NAMES as readonly string[]).includes(k.kind)) {
        throw new Error(`deployment: extraKinds names "${k.kind}", which is a kernel kind`);
      }
      if (seen.has(k.kind)) throw new Error(`deployment: extraKinds repeats "${k.kind}"`);
      if (k.layer !== 'kernel' && k.layer !== 'atlas' && k.layer !== 'deployment') {
        throw new Error(`deployment: extraKinds "${k.kind}" has no valid layer`);
      }
      if (k.bearsClaims) objectSchemaOf(k);
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

  const literals: KindLiterals = {
    sourceLanguages: deployment.sourceLanguages,
    translatedLocales: deployment.translatedLocales
  };

  const kinds: KindDefinition[] = [...createKernelKinds(literals), ...(deployment.extraKinds ?? [])];
  const kindMap: ReadonlyMap<string, KindDefinition> = new Map(kinds.map((k) => [k.kind, k]));
  const claimKinds: ReadonlySet<string> = new Set(kinds.filter((k) => k.bearsClaims).map((k) => k.kind));

  const envelope: Envelope = Object.freeze({
    exceptions: NO_EXCEPTIONS,
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

  /**
   * Stage 1. Every record through its kind's schema; a schema-level problem is
   * a finding, never a thrown error. The register is converted once per call,
   * so it is the register this call was given that decides which records parse
   * and which findings stand.
   */
  function parse(raw: RawDataset, register?: ExceptionRegister): { records: ParsedDataset; findings: Finding[] } {
    const exceptions = convertRegister(register, time.cutoff);
    const findings: Finding[] = [];

    for (const entry of exceptions.expired) {
      findings.push({
        rule: entry.findingRule,
        severity: 'error',
        ...(entry.record ? { record: entry.record } : {}),
        message: `the exception "${entry.key}" no longer counts: ${entry.detail}; source the record, fix it, or re-justify it with a new deadline`
      });
    }

    const records: Record<string, { id: string }[]> = {};
    const named = Object.keys(raw);
    const order = [...kindMap.keys(), ...named.filter((kind) => !kindMap.has(kind))];

    for (const kind of order) {
      const def = kindMap.get(kind);
      if (!def) {
        findings.push({
          rule: SCHEMA_RULE,
          severity: 'error',
          message: `unknown kind "${kind}": the engine has no schema for it, so its records are not read`
        });
        continue;
      }

      const out: { id: string }[] = [];
      records[kind] = out;
      const list = raw[kind];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        findings.push({
          rule: SCHEMA_RULE,
          severity: 'error',
          message: `kind "${kind}" must be a list of records`
        });
        continue;
      }

      const schema = envelopedSchema(def, exceptions);
      list.forEach((entry, index) => {
        const label = recordLabel(entry, index);
        const result = schema.safeParse(entry);
        if (result.success) {
          out.push(result.data as { id: string });
          return;
        }
        for (const issue of result.error.issues) {
          const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
          findings.push({
            rule: issueRule(issue),
            severity: 'error',
            record: { kind, id: label },
            message: `${kind} ${label}: ${path}${issue.message}`
          });
        }
      });
    }

    return { records, findings };
  }

  function resolve(): never {
    return notBuilt('resolve', 4);
  }
  function validate(): never {
    return notBuilt('validate', 4);
  }

  const splicer = createSplicer();

  const canonical: Canonical = Object.freeze({
    project: (dataset: unknown, opts?: CanonicalOptions) => canonicalProject(dataset, opts),
    hash: (dataset: unknown, opts?: CanonicalOptions) => canonicalHash(dataset, opts)
  });

  const rules: readonly Rule[] = Object.freeze([...KERNEL_RULES, ...(deployment.extraRules ?? [])]);

  const engine: Engine = {
    deployment,
    time,
    envelope,
    kinds: kindMap,
    rules,
    splicer,
    canonical,
    parse,
    resolve,
    validate,
    check(raw: RawDataset, register?: ExceptionRegister) {
      const { findings } = parse(raw, register);
      if (findings.some((f) => f.severity === 'error')) {
        return { ok: false, findings };
      }
      resolve();
      validate();
      return { ok: false, findings };
    },
    buildMatcher(): never {
      return notBuilt('buildMatcher', 5);
    }
  };

  return Object.freeze(engine);
}

/** The record label a finding names: the authored id, or its position. */
function recordLabel(entry: unknown, index: number): string {
  if (entry && typeof entry === 'object' && 'id' in entry) {
    const id = (entry as { id: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return `#${index}`;
}

/** The atlas defaults a deployment starts from. */
export { atlasDefaults } from './atlas/vocabulary.ts';
export { createTime };
