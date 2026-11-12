/**
 * examples/ruritania/deployment.ts: one country, written as data.
 *
 * Ruritania is the invented jurisdiction the example data ships with. It is a
 * whole deployment: the values the engine used to hold in parameters.yaml and
 * the vocabulary it used to hold in claim.ts, in one object a fork can copy.
 *
 * No engine code lives here. If a second subject needs a different engine, the
 * difference is in this file.
 */

import type { Deployment } from '../../src/engine.ts';
import { atlasDefaults } from '../../src/atlas/vocabulary.ts';

export const ruritania: Deployment = {
  name: 'Ruritania',

  time: {
    floor: '1900-01-01',
    cutoff: '2026-06-01',
    beforeWindowYears: 8,
    approxSlackDays: { year: 365, month: 92 }
  },

  translatedLocales: ['fr', 'ar'],
  sourceLanguages: ['ar', 'fr', 'en', 'it', 'de'],

  gazette: {
    vocabulary: ['gazette', 'decree text', 'décret', 'jort'],
    sourcePrefixes: ['gazette-', 'decree-', 'jort-']
  },
  registry: {
    label: 'Company Register',
    idLabel: 'CRN',
    registries: ['company-register']
  },
  bbox: { lonMin: 15, lonMax: 17, latMin: 45, latMax: 47 },

  reviewerLabels: ['Gazette verification pass'],

  index: atlasDefaults.index,

  vocabulary: {
    ...atlasDefaults.vocabulary,
    // The administrative ladder is the deployment's: Ruritania has provinces.
    regionKinds: ['province']
  },

  // Word lists for the name matcher (slice 5). Ruritania's names follow the
  // same particle patterns the matcher already splits.
  matcher: {
    particles: ['Ben', 'El', 'Al'],
    functionWords: ['of', 'the', 'de', 'du', 'des', 'bin', 'bint'],
    splittablePrefixes: ['Ben']
  }
};

export default ruritania;
