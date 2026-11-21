/**
 * atlas/rules/event-orphan.ts: V11, an event nobody is linked to.
 *
 * An event's participants are its `actors`, its organisations are its
 * `institutions`, and its documents are its `documents`: the external
 * references the event rests on. A recorded dispute (`disputes`) also anchors
 * an event: the register already says who holds a competing claim about it.
 * An event with none of the four is orphaned, a claim about nothing in the
 * map. `materials` is a media list, not a document reference, and does not
 * keep an event linked.
 *
 * A warning, not an error: the event still says something true; it just has
 * no edges yet.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

type EventRow = {
  id?: unknown;
  actors?: unknown;
  institutions?: unknown;
  documents?: unknown;
  disputes?: unknown;
};

/** True when the list field is present and names at least one entry. */
function carries(list: unknown): boolean {
  return Array.isArray(list) && list.length > 0;
}

export const V11: Rule = Object.freeze({
  id: 'V11',
  title: 'Events with no participants, organisations, documents or recorded disputes are orphaned',
  layer: 'atlas',
  severity: 'warning',
  needs: 'parsed',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const event of (ctx.records.event ?? []) as unknown as EventRow[]) {
      if (carries(event.actors) || carries(event.institutions) || carries(event.documents) || carries(event.disputes)) continue;
      const id = typeof event.id === 'string' ? event.id : '';
      findings.push({
        rule: 'V11',
        severity: 'warning',
        record: { kind: 'event', id },
        message:
          'an event with no actors, institutions, documents or recorded disputes is orphaned: link it into the map, or record why it stands alone (V11)'
      });
    }
    return findings;
  }
});
