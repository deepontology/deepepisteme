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
    regionKinds: ['province'],
    // And the deployment may extend a default list: the example data's
    // university needs a type the default vocabulary does not carry.
    institutionTypes: [...atlasDefaults.vocabulary.institutionTypes, 'university']
  },

  // The name matcher's word lists: Ruritania's own naming conventions. A
  // fork replaces these with its country's particles and grammatical words;
  // the matcher itself is engine code reached as engine.match.
  matcher: {
    // Nasab particles: never a match alone, but they carry weight in a phrase.
    particles: ['ben', 'el', 'al', 'bin', 'bint'],
    // Grammatical words that narrow nothing.
    functionWords: ['of', 'the', 'de', 'du', 'des'],
    // Surnames written as one word after these are split back apart.
    splittablePrefixes: ['ben', 'el'],
    // A surname block extends leftwards through these.
    surnameHeads: ['ben', 'el', 'al']
  }
};

export default ruritania;
