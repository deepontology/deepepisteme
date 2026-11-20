/**
 * atlas/kinds/index.ts: the register of the record kinds of a map of power.
 *
 * Slice 3 ports them from the consumer's schema, one file per kind, so its
 * records parse byte-identically here. Every schema is built inside a function
 * of the deployment's literals, never at module load, because the lists a
 * schema validates against (types, layers, channels, registries, the box) are
 * the deployment's. Two engines in one process build two registers.
 *
 * Claim-bearing kinds are declared as their plain object schema; parse()
 * applies the envelope with that call's exception register, so an excepted
 * record parses exactly like a compliant one with no state held between
 * calls. Scaffolding kinds (role, era, and the group layer) carry no
 * envelope: their standing is the standing of the records inside them.
 */

import type { KindDefinition } from '../../kernel/kinds.ts';
import type { ReviewSchema } from '../../kernel/review.ts';
import { eraSchema } from './era.ts';
import { eventSchema } from './event.ts';
import { institutionSchema } from './institution.ts';
import { personSchema } from './person.ts';
import { positionSchema } from './position.ts';
import { relationshipRefines, relationshipSchema } from './relationship.ts';
import { roleSchema } from './role.ts';

export { eraSchema } from './era.ts';
export { eventSchema } from './event.ts';
export { institutionSchema } from './institution.ts';
export { personSchema } from './person.ts';
export { positionSchema } from './position.ts';
export { relationshipRefines, relationshipSchema } from './relationship.ts';
export { roleSchema } from './role.ts';

/** The deployment values the atlas schemas validate against. */
export interface AtlasLiterals {
  /** The jurisdiction's name, read by the bounding-box message a place's coordinates carry. */
  readonly name: string;
  /** Languages prose is translated into. */
  readonly translatedLocales: readonly string[];
  /** The strict review object, built from the deployment's reviewer labels. */
  readonly review: ReviewSchema;
  /** Vocabulary a deployment may extend or trim. */
  readonly institutionTypes: readonly string[];
  readonly layers: readonly string[];
  readonly relationshipTypes: readonly string[];
  readonly influenceChannels: readonly string[];
  readonly agreementKinds: readonly string[];
  readonly placeKinds: readonly string[];
  /** The corporate registries a company registration may name. */
  readonly registries: readonly string[];
  /** The jurisdiction's WGS84 bounding box, for place coordinates. */
  readonly bbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };
}

/** The atlas kinds, built for one deployment's literals. */
export function createAtlasKinds(l: AtlasLiterals): readonly KindDefinition[] {
  return Object.freeze([
    {
      kind: 'institution',
      file: 'institutions.yaml',
      schema: institutionSchema(l),
      bearsClaims: true,
      layer: 'atlas'
    },
    { kind: 'role', file: 'roles.yaml', schema: roleSchema(l), bearsClaims: false, layer: 'atlas' },
    {
      kind: 'person',
      file: 'people.yaml',
      schema: personSchema(l),
      bearsClaims: true,
      layer: 'atlas'
    },
    {
      kind: 'position',
      file: 'positions.yaml',
      schema: positionSchema(l),
      bearsClaims: true,
      layer: 'atlas'
    },
    {
      kind: 'relationship',
      file: 'relationships.yaml',
      schema: relationshipSchema(l),
      bearsClaims: true,
      layer: 'atlas',
      afterEnvelope: relationshipRefines
    },
    {
      kind: 'event',
      file: 'events.yaml',
      schema: eventSchema(l),
      bearsClaims: true,
      layer: 'atlas'
    },
    { kind: 'era', file: 'eras.yaml', schema: eraSchema(l), bearsClaims: false, layer: 'atlas' }
  ]);
}
