/**
 * config.ts — ParametersSchema, the fork point.
 *
 * A jurisdiction retargets the whole engine by editing one file:
 * data/parameters.yaml. Every jurisdiction-specific literal — bounding box,
 * gazette vocabulary, registry, floor/cutoff, slack windows, discount weights —
 * lives here, is validated strictly (unknown key = build failure), and is
 * published into the emitted artifact so every derived number is recomputable.
 *
 * Parameters are configuration, not claims: no basis, no sources, no confidence.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const ParametersSchema = z.strictObject({
  jurisdiction: z.strictObject({
    name: z.string().min(2),
    bbox: z.strictObject({
      lonMin: z.number(),
      lonMax: z.number(),
      latMin: z.number(),
      latMax: z.number()
    }),
    gazette: z.strictObject({
      vocabulary: z.array(z.string()).min(1),
      sourcePrefixes: z.array(z.string()).min(1)
    }),
    registry: z.strictObject({
      label: z.string(),
      idLabel: z.string(),
      registries: z.array(z.string()).min(1)
    })
  }),
  time: z.strictObject({
    floor: z.string(),
    cutoff: z.string(),
    beforeWindowYears: z.number().positive(),
    approxSlackDays: z.strictObject({
      year: z.number().positive(),
      month: z.number().positive()
    })
  }),
  index: z.strictObject({
    discount: z.strictObject({
      documented: z.number(),
      reported: z.number(),
      inferred: z.number(),
      unsubstantiated: z.number()
    })
  })
});

export type Parameters = z.infer<typeof ParametersSchema>;

/**
 * Shipped example — the synthetic jurisdiction "Ruritania" that the
 * data/ template ships with. The Tunisia defaults live in the DeepTunisia
 * repository; this crate ships with a neutral example so a reviewer can
 * see the fork in one diff.
 */
export const DEFAULT_PARAMETERS: Parameters = {
  jurisdiction: {
    name: 'Ruritania',
    bbox: { lonMin: 15, lonMax: 17, latMin: 45, latMax: 47 },
    gazette: {
      vocabulary: ['gazette', 'decree text', 'décret', 'jort'],
      sourcePrefixes: ['gazette-', 'decree-', 'jort-']
    },
    registry: {
      label: 'Company Register',
      idLabel: 'CRN',
      registries: ['company-register']
    }
  },
  time: {
    floor: '1900-01-01',
    cutoff: '2026-06-01',
    beforeWindowYears: 8,
    approxSlackDays: { year: 365, month: 92 }
  },
  index: {
    discount: { documented: 1, reported: 0.55, inferred: 0.2, unsubstantiated: 0 }
  }
};

let active: Parameters = DEFAULT_PARAMETERS;

export function getParameters(): Parameters {
  return active;
}

export function configureAll(p: Parameters): void {
  active = p;
}

export function loadParameters(path: string): Parameters {
  const raw = parseYaml(readFileSync(path, 'utf8'));
  const parsed = ParametersSchema.parse(raw);
  active = parsed;
  return parsed;
}
