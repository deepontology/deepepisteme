/**
 * index.ts — public entry point.
 *
 * 1.0 entry: `createEngine(deployment)` (src/engine.ts) returns a time model
 * and the claim envelope, wired to one deployment. `createTime(parameters)` is
 * exported separately because a browser bundle needs dates and nothing else.
 *
 * The v0.1 subpaths (deepepisteme/time, /claim, /validate, /parameters) still
 * resolve during the move and delegate to one default engine; they are removed
 * in slice 3.
 */

export * from './parameters.ts';
export * from './time.ts';
export * from './claim.ts';
export * from './validate.ts';

export { createEngine } from './engine.ts';
export { createTime } from './kernel/time.ts';
export { atlasDefaults } from './atlas/vocabulary.ts';

export type { Time } from './kernel/time.ts';
export type {
  Canonical,
  Deployment,
  Engine,
  Envelope,
  Finding,
  KindDefinition,
  ParsedDataset,
  RawDataset,
  ResolvedDataset,
  Rule,
  Splicer
} from './engine.ts';
