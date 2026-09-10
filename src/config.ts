/**
 * config.ts — the parameters loader.
 *
 * The schema and the active parameters live in parameters.ts, which has no
 * filesystem import so browser code can consume the engine core without
 * pulling `node:fs` into a client bundle. This module adds the one operation
 * that needs the filesystem: reading data/parameters.yaml and installing the
 * parsed result as the active parameter set.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  ParametersSchema,
  DEFAULT_PARAMETERS,
  configureAll,
  getParameters,
  type Parameters
} from './parameters.ts';

export { ParametersSchema, DEFAULT_PARAMETERS, configureAll, getParameters };
export type { Parameters };

export function loadParameters(path: string): Parameters {
  const raw = parseYaml(readFileSync(path, 'utf8'));
  const parsed = ParametersSchema.parse(raw);
  configureAll(parsed);
  return parsed;
}
