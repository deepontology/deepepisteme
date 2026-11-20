/**
 * atlas/rules/event-rupture.ts: V17, a rupture that floats.
 *
 * A rupture event is the register saying "everything after this is different",
 * which only means something if the event is linked into the causal graph. A
 * rupture linked to nothing is a gap the reviewer should see: flagged, not
 * failed.
 *
 * Ported from the consumer's build script with its message.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

type EventRow = {
  id?: unknown;
  rupture?: unknown;
  causes?: unknown;
  consequences?: unknown;
};

export const V17: Rule = Object.freeze({
  id: 'V17',
  title: 'A rupture event not linked into the causal graph is flagged',
  layer: 'atlas',
  severity: 'warning',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const ev of (ctx.records.event ?? []) as unknown as EventRow[]) {
      if (!ev.rupture) continue;
      const causes = Array.isArray(ev.causes) ? ev.causes.length : 0;
      const consequences = Array.isArray(ev.consequences) ? ev.consequences.length : 0;
      if (causes !== 0 || consequences !== 0) continue;
      findings.push({
        rule: 'V17',
        severity: 'warning',
        record: { kind: 'event', id: typeof ev.id === 'string' ? ev.id : '' },
        message: 'rupture event is not linked into the causal graph (V17)'
      });
    }
    return findings;
  }
});
