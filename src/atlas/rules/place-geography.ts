/**
 * atlas/rules/place-geography.ts: V10, the generic half of the geographic hierarchy.
 *
 * Three checks over the places a deployment loads:
 * - a place needs a parent region unless it is a quarter or a town (error);
 * - a parented place's owner must be a graph entity: a person, an institution
 *   or a role (error);
 * - a parented place with no coordinates cannot be put on the map (warning).
 *
 * That the parent names a region that exists, that the region chain ends, and
 * the dates a region came into being are the deployment's own regions and stay
 * a deployment rule (`extraRules`). Coordinates inside the jurisdiction box are
 * already checked by the place kind's schema.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

type PlaceRow = {
  id?: unknown;
  kind?: unknown;
  parent?: unknown;
  owner?: unknown;
  coordinates?: unknown;
};

/** Place kinds that may stand without a parent region. */
const PARENTLESS_KINDS: ReadonlySet<string> = new Set(['quarter', 'town']);

/** The kinds a place owner may be. */
const ENTITY_KINDS = ['person', 'institution', 'role'] as const;

export const V10: Rule = Object.freeze({
  id: 'V10',
  title: 'A place has a parent region, a real owner if it names one, and coordinates for the map',
  layer: 'atlas',
  severity: 'error',
  needs: 'parsed',
  run(ctx: RuleContext): Finding[] {
    const entities = new Set<string>();
    for (const kind of ENTITY_KINDS) {
      for (const record of ctx.records[kind] ?? []) entities.add(record.id);
    }
    const findings: Finding[] = [];
    for (const place of (ctx.records.place ?? []) as unknown as PlaceRow[]) {
      const id = typeof place.id === 'string' ? place.id : '';
      const record = { kind: 'place', id };
      if (!place.parent) {
        if (typeof place.kind !== 'string' || !PARENTLESS_KINDS.has(place.kind)) {
          findings.push({
            rule: 'V10',
            severity: 'error',
            record,
            message: 'every place needs a parent region/governorate (V10)'
          });
        }
        continue;
      }
      if (typeof place.owner === 'string' && place.owner && !entities.has(place.owner)) {
        findings.push({
          rule: 'V10',
          severity: 'error',
          record,
          message: `unknown owner "${place.owner}" (must be a graph entity)`
        });
      }
      if (!place.coordinates) {
        findings.push({
          rule: 'V10',
          severity: 'warning',
          record,
          message: 'no coordinates: the map cannot place it (V10)'
        });
      }
    }
    return findings;
  }
});
