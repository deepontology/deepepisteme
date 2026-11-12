/**
 * kernel/canonical.ts: the stable projection of a dataset and its hash.
 *
 * A dataset is the product. Two builds from the same input must produce the same
 * hash, so the projection replaces the one wall-clock field with a fixed
 * stand-in and sorts every object key. Arrays keep their emitted order: order is
 * meaning in a curated list, so a reordered array is a different dataset.
 *
 * What a given build emits but the hash must ignore (derived fields, payload
 * sizes) is not known here. It arrives as drop paths, so a ledger of court cases
 * can drop its own derived fields without a branch in this file.
 *
 * Drop path form: a dotted path from the dataset root. A segment ending in `[]`
 * means every element of that array. deeptunisia's three cases are:
 *
 *   people[].timeline
 *   institutions[].timeline
 *   meta.shippedKB
 *   meta.datasetKB
 *
 * A path that names nothing in a given dataset drops nothing; a malformed path
 * is a programming error and throws.
 */
import { createHash } from 'node:crypto';

/** Fixed stand-in for `meta.generated` in every projection. */
export const CANONICAL_GENERATED = '1970-01-01T00:00:00.000Z';

/** Deep key sort. Arrays keep their order; object keys become stable. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) out[key] = sortKeys(record[key]);
    return out;
  }
  return value;
}

/** `people[].timeline` becomes the segments `people`, `*`, `timeline`. */
function parsePath(path: string): string[] {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('canonical: a drop path must be a non-empty string');
  }
  const segments: string[] = [];
  for (const raw of path.split('.')) {
    if (raw === '') throw new Error(`canonical: drop path "${path}" has an empty segment`);
    if (raw.endsWith('[]')) {
      const name = raw.slice(0, -2);
      if (name === '') throw new Error(`canonical: drop path "${path}" has an empty array name`);
      segments.push(name, '*');
    } else {
      segments.push(raw);
    }
  }
  return segments;
}

function dropAt(node: unknown, segments: readonly string[], at: number): void {
  if (at >= segments.length) return;
  const segment = segments[at];
  const last = at === segments.length - 1;

  if (segment === '*') {
    if (!Array.isArray(node)) return;
    for (const element of node) dropAt(element, segments, at + 1);
    return;
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;

  const record = node as Record<string, unknown>;
  if (last) {
    delete record[segment];
    return;
  }
  dropAt(record[segment], segments, at + 1);
}

export interface CanonicalOptions {
  /** Fields to leave out of the projection, as dotted paths. */
  drop?: readonly string[];
}

function withCanonicalMeta(copy: Record<string, unknown>): void {
  const meta = copy.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    (meta as Record<string, unknown>).generated = CANONICAL_GENERATED;
  }
}

/**
 * The stable projection `hash` is computed over: drop paths applied, the
 * wall-clock timestamp replaced, keys deep-sorted. The input is not modified.
 * `meta.datasetHash` is kept, so canonical bytes can carry their own hash.
 */
export function project(dataset: unknown, opts?: CanonicalOptions): unknown {
  const copy = structuredClone(dataset) as Record<string, unknown>;
  for (const path of opts?.drop ?? []) dropAt(copy, parsePath(path), 0);
  withCanonicalMeta(copy);
  return sortKeys(copy);
}

/** sha256 hex of the projection, with its self-referential hash removed. */
export function hash(dataset: unknown, opts?: CanonicalOptions): string {
  const projection = structuredClone(project(dataset, opts)) as Record<string, unknown>;
  const meta = projection.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    delete (meta as Record<string, unknown>).datasetHash;
  }
  return createHash('sha256')
    .update(JSON.stringify(projection, null, 2) + '\n')
    .digest('hex');
}
