/**
 * atlas/rules/interval-trims.ts: V22, a clamp is published, never silent.
 *
 * `resolve` holds every settled interval to the cutoff: an authored end past
 * it is pulled back to it and marked `trimmed`, and a start that could then
 * fall after the lowered end is pulled down to it and marked `startClamped`.
 * The authored token stays in `raw`; this rule is the other half of that
 * contract. Each clamped interval is one warning that names the record, so an
 * editor can fix the span instead of the clamp growing out of sight.
 *
 * The ongoing downgrade, the other V22 warning, is `resolve`'s own finding: it
 * is raised while the interval is settled, and it is not repeated here. An
 * interval that cannot resolve at all is V15, an error.
 *
 * Every kind `resolve` settles is reported, not only positions, relationships
 * and events. A warning does not fail a build.
 */

import type { Finding, Rule, RuleContext } from '../../kernel/rules.ts';

export const V22: Rule = Object.freeze({
  id: 'V22',
  title: 'A clamped interval is published with its record',
  layer: 'atlas',
  severity: 'warning',
  needs: 'resolved',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const resolved = ctx.resolved;
    if (!resolved) return findings;
    for (const [key, interval] of resolved.intervals) {
      if (!interval.trimmed && !interval.startClamped) continue;
      const cut = key.indexOf(':');
      if (cut < 1) continue;
      const clamps: string[] = [];
      if (interval.trimmed) clamps.push('its end is pulled back to the research cutoff (published as trimmed)');
      if (interval.startClamped) clamps.push('its start is pulled down to its end (published as startClamped)');
      findings.push({
        rule: 'V22',
        severity: 'warning',
        record: { kind: key.slice(0, cut), id: key.slice(cut + 1) },
        message: `interval envelope clamped: ${clamps.join('; ')} (V22)`
      });
    }
    return findings;
  }
});
