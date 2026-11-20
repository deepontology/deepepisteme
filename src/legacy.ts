/**
 * legacy.ts: the one default engine the v0.1 modules delegate to.
 *
 * The v0.1 modules (time.ts, claim.ts, validate.ts) are still imported by
 * build.ts and test.ts during slice 0. They read this engine instead of
 * holding their own configuration. A caller that wants its own configuration
 * creates its own engine; this one exists only for the old import paths.
 *
 * Its values are the Ruritania values (see examples/ruritania/deployment.ts;
 * test/engine.ts checks the two agree on everything these modules read).
 *
 * Slice 3 moves the kinds this module's readers used into src/atlas/kinds/;
 * the module itself stays while the v0.1 build and test gates still import
 * it, and is removed when those gates move to createEngine.
 */

import { createEngine, type Deployment } from './engine.ts';
import { atlasDefaults } from './atlas/vocabulary.ts';
import { DEFAULT_PARAMETERS } from './parameters.ts';

export const legacyDeployment: Deployment = {
  name: DEFAULT_PARAMETERS.jurisdiction.name,
  time: DEFAULT_PARAMETERS.time,
  translatedLocales: ['fr', 'ar'],
  sourceLanguages: ['ar', 'fr', 'en', 'it', 'de'],
  gazette: DEFAULT_PARAMETERS.jurisdiction.gazette,
  registry: DEFAULT_PARAMETERS.jurisdiction.registry,
  bbox: DEFAULT_PARAMETERS.jurisdiction.bbox,
  reviewerLabels: [],
  index: DEFAULT_PARAMETERS.index,
  vocabulary: {
    ...atlasDefaults.vocabulary,
    regionKinds: ['province'],
    institutionTypes: [...atlasDefaults.vocabulary.institutionTypes, 'university']
  },
  matcher: {
    particles: ['ben', 'el', 'al', 'bin', 'bint'],
    functionWords: ['of', 'the', 'de', 'du', 'des'],
    splittablePrefixes: ['ben', 'el'],
    surnameHeads: ['ben', 'el', 'al']
  }
};

export const legacyEngine = createEngine(legacyDeployment);
