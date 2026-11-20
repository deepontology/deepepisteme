/**
 * atlas: the record-kind schema factories of a map of power, for a consumer
 * that wants the record types and not only the parsed records.
 *
 * `engine.kinds` and `engine.parse` carry no static types, because a kind is
 * registered as a bare schema. Each factory here takes the deployment's
 * literals and returns the kind's object schema, so `z.infer` of its result is
 * the record type. A consumer narrows the few fields a deployment's vocabulary
 * decides (layers, institution types, languages) on its own side; the
 * schemas it parses with come from `engine.schemaOf`, which closes a kind over
 * the claim envelope exactly as `engine.parse` does.
 *
 * This module imports no package beyond zod and the kernel, so it is safe to
 * load from a build script and from a type position alike.
 */

export {
  agreementSchema,
  companySchema,
  contractSchema,
  createAtlasKinds,
  declarationSchema,
  educationSchema,
  eraSchema,
  eventSchema,
  groupLayerSchema,
  institutionSchema,
  licenceSchema,
  personSchema,
  placeSchema,
  positionSchema,
  relationshipRefines,
  relationshipSchema,
  roleSchema,
  vacancySchema,
  worldClaimSchema
} from './kinds/index.ts';
export type { AtlasLiterals } from './kinds/index.ts';
