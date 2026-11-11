/**
 * atlas/vocabulary.ts — the default vocabulary of a map of power.
 *
 * These lists are the starting point a deployment extends or trims: layers,
 * institution types, relationship types and their direction, influence
 * channels, agreement kinds, place kinds. They are data for a power map, not
 * facts about one country, so they live in the atlas layer and a deployment
 * copies them.
 *
 * `regionKinds` is deliberately absent: which administrative ladder exists is
 * the deployment's call (Tunisia: governorate, delegation, municipality).
 */

import type { BasisValue } from '../kernel/basis.ts';

export type EdgeDirectionKind = 'directed' | 'symmetric' | 'contextual';

/** Analytical layers. An entity in several layers is a bridge node. */
export const layers = [
  'security',
  'political',
  'economic',
  'media',
  'judicial',
  'civil',
  'foreign'
] as const;

export const institutionTypes = [
  'presidency',
  'government',
  'ministry',
  'military',
  'police',
  'party',
  'company',
  'association',
  'media',
  'legislature',
  'judiciary',
  'bank',
  'state-enterprise',
  'holding',
  'ngo',
  'regulator',
  'university'
] as const;

export const relationshipTypes = [
  'institutional',
  'appointment',
  'succession',
  'family',
  'business',
  'party',
  'security',
  'funding',
  'diplomatic',
  'political-alliance',
  'political-conflict',
  'prosecution',
  'reported-influence',
  'allegation',
  'dismissal',
  'ownership',
  'board',
  'shareholder',
  'sponsorship',
  'partnership',
  'franchise',
  'oversight',
  'regulatory-authority',
  'licence',
  'sanction',
  'coalition',
  'endorsement',
  'candidate-campaign',
  'influence',
  'advisory'
] as const;

/**
 * Direction per relationship type. `directed` means from→to is the claim and
 * reversing it asserts a different one; `symmetric` means the edge is its own
 * converse; `contextual` means direction is meaningful but not enforced.
 */
export const edgeDirection: Record<(typeof relationshipTypes)[number], EdgeDirectionKind> = {
  institutional: 'contextual',
  appointment: 'directed',
  succession: 'directed',
  dismissal: 'directed',
  family: 'symmetric',
  business: 'contextual',
  party: 'contextual',
  security: 'contextual',
  funding: 'directed',
  diplomatic: 'symmetric',
  'political-alliance': 'symmetric',
  'political-conflict': 'symmetric',
  prosecution: 'directed',
  'reported-influence': 'contextual',
  allegation: 'contextual',
  ownership: 'directed',
  board: 'directed',
  shareholder: 'directed',
  sponsorship: 'directed',
  partnership: 'symmetric',
  franchise: 'directed',
  oversight: 'directed',
  'regulatory-authority': 'directed',
  licence: 'directed',
  sanction: 'directed',
  coalition: 'symmetric',
  endorsement: 'directed',
  'candidate-campaign': 'directed',
  influence: 'directed',
  advisory: 'directed'
};

/** The empty string is a stated absence: the edge exists, its channel is unknown. */
export const influenceChannels = [
  'appointment',
  'advice-relationship',
  'money',
  'publicity',
  'marriage',
  'secret',
  ''
] as const;

export const agreementKinds = [
  'association',
  'accession',
  'free-trade',
  'customs-union',
  'investment',
  'double-taxation',
  'other'
] as const;

export const placeKinds = [
  'port',
  'airport',
  'military-base',
  'power-plant',
  'pipeline',
  'water',
  'desalination',
  'road',
  'rail',
  'industrial-zone',
  'free-zone',
  'resource-field',
  'embassy',
  'palace',
  'town',
  'quarter'
] as const;

/** Basis-discount weights for ranked indices: unsubstantiated evidence weighs nothing. */
export const defaultIndex: { discount: Record<BasisValue, number> } = Object.freeze({
  discount: { documented: 1, reported: 0.55, inferred: 0.2, unsubstantiated: 0 }
});

export const atlasDefaults = {
  vocabulary: {
    layers,
    institutionTypes,
    relationshipTypes,
    edgeDirection,
    influenceChannels,
    agreementKinds,
    placeKinds
  },
  index: defaultIndex
};
