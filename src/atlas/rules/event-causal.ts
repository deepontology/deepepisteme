/**
 * atlas/rules/event-causal.ts: V8, the event causal graph.
 *
 * `causes` and `consequences` are event-to-event edges. A cause cannot begin
 * after its consequence is over, unless the consequence records its own
 * disputed dating; and a causal cycle is impossible in reality and fails,
 * found by Tarjan's strongly connected components over the cause edges.
 *
 * Ported from the consumer's build script, including its two messages and the
 * dispute escape on the consequence.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';
import type { ResolvedInterval } from '../../kernel/time.ts';

type EventRow = {
  id?: unknown;
  date?: unknown;
  causes?: unknown;
  consequences?: unknown;
  disputes?: unknown;
};

function idOf(ev: EventRow): string {
  return typeof ev.id === 'string' ? ev.id : '';
}

export const V8: Rule = Object.freeze({
  id: 'V8',
  title: 'A cause cannot begin after its consequence, and a causal cycle fails',
  layer: 'atlas',
  severity: 'error',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const events = (ctx.records.event ?? []) as unknown as EventRow[];
    const resolved = ctx.resolved;
    const byId = new Map(events.map((ev) => [idOf(ev), ev]));
    const intervalOf = (id: string): ResolvedInterval | undefined => resolved?.intervals.get(`event:${id}`);
    const cutoff = resolved?.cutoff ?? 0;

    // Temporal ordering: the cause cannot begin after its consequence is over.
    for (const ev of events) {
      const consequence = intervalOf(idOf(ev));
      if (!consequence) continue;
      for (const causeId of Array.isArray(ev.causes) ? ev.causes : []) {
        if (typeof causeId !== 'string') continue;
        const cause = byId.get(causeId);
        const causeInterval = intervalOf(causeId);
        if (!cause || !causeInterval) continue;
        const ends = consequence.endLatest ?? cutoff;
        if (causeInterval.startEarliest > ends) {
          const disputed = Array.isArray(ev.disputes) && ev.disputes.length > 0;
          if (!disputed) {
            findings.push({
              rule: 'V8',
              severity: 'error',
              record: { kind: 'event', id: idOf(ev) },
              message: `cause "${causeId}" (${typeof cause.date === 'string' ? cause.date : '?'}) begins after its consequence ends — reorder or record a dispute (V8)`
            });
          }
        }
      }
    }

    // A causal cycle is impossible: Tarjan's SCC over the cause edges.
    const adjacency = new Map<string, string[]>();
    for (const ev of events) {
      adjacency.set(
        idOf(ev),
        (Array.isArray(ev.causes) ? ev.causes : []).filter((id): id is string => typeof id === 'string')
      );
    }
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let counter = 0;
    const cycles: string[][] = [];
    const strong = (v: string): void => {
      index.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      for (const w of adjacency.get(v) ?? []) {
        if (!byId.has(w)) continue; // an unknown id is not an edge of the graph
        if (!index.has(w)) {
          strong(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      }
      if (low.get(v) === index.get(v)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        if (component.length > 1) cycles.push(component);
      }
    };
    for (const ev of events) {
      if (!index.has(idOf(ev))) strong(idOf(ev));
    }
    for (const cycle of cycles) {
      findings.push({
        rule: 'V8',
        severity: 'error',
        message: `causal cycle: ${cycle.join(' → ')} (V8)`
      });
    }
    return findings;
  }
});
