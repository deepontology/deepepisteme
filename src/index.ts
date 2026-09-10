/**
 * index.ts — public entry point.
 *
 * The engine is consumed module by module: `deepepisteme/time` for the interval
 * resolver and predicates, `deepepisteme/claim` for the evidence envelope.
 * This root entry re-exports the core so a consumer can also take the whole
 * surface in one import.
 */

export * from './parameters.ts';
export * from './time.ts';
export * from './claim.ts';
export * from './validate.ts';
