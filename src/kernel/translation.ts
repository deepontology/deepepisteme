/**
 * kernel/translation.ts: the translation ladder.
 *
 * Prose in a second language has a provenance: machine, model-reviewed,
 * machine-reviewed, human. The ladder is kernel; which languages a deployment
 * translates into is deployment data and lives on the deployment.
 */

import { z } from 'zod';

export const TranslatedBy = z.enum(['machine', 'model-reviewed', 'machine-reviewed', 'human']);

/** The same ladder as a list, for code that ranks or filters rather than validates. */
export const TRANSLATION_TIERS = ['machine', 'model-reviewed', 'machine-reviewed', 'human'] as const;
