/**
 * atlas/kinds/place.ts: a point feature with coordinates.
 *
 * Coordinates are a claim like any other number: authored only from a cited
 * source, and inside the deployment's bounding box. The box and the
 * jurisdiction's name come from the literals, so the refusal message carries
 * the deployment's own words.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import { slug } from '../../kernel/envelope.ts';
import { EvidenceSchema } from '../../kernel/evidence.ts';
import { claimFields, translatable } from '../../kernel/kinds.ts';
import type { AtlasLiterals } from './index.ts';

/** WGS84 [lon, lat], within the deployment's bounding box. */
function coordinates(l: AtlasLiterals) {
  return z
    .array(z.number())
    .length(2)
    .refine(
      ([lon, lat]) => {
        const b = l.bbox;
        return lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;
      },
      {
        // zod 4 runs a function message but types the field as a string; the
        // consumer's own coordinates check passes the same function.
        message: (() => {
          const b = l.bbox;
          return `coordinates must fall inside ${l.name} (lon ${b.lonMin}..${b.lonMax}, lat ${b.latMin}..${b.latMax})`;
        }) as unknown as string
      }
    );
}

/** The place kind's object schema, before the envelope is applied. */
export function placeSchema(l: AtlasLiterals) {
  return z.strictObject({
    id: slug,
    kind: z.enum(l.placeKinds as unknown as [string, ...string[]]),
    name_en: z.string().min(2),
    name_fr: z.string().optional(),
    name_ar: z.string().optional(),
    /** Region this place belongs to; the chain must terminate. */
    parent: slug.optional(),
    /** [lon, lat] WGS84. */
    coordinates: coordinates(l).optional(),
    /** Strategic asset flag: feeds the economic layer. */
    asset: z.boolean().default(false),
    /** Graph entity that owns or operates it, when known. */
    owner: slug.optional(),
    ...claimFields(l.review),
    evidence: z.array(EvidenceSchema).optional(),
    /** Source-backed notes; the base key must exist or a strict parse drops them. */
    notes: z.array(z.string()).default([]),
    ...translatable('notes', l.translatedLocales, 'list')
  });
}
