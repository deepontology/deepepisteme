/**
 * kernel/rules.ts: findings and the validators that produce them.
 *
 * A data problem is a finding, never a thrown error: a rule id, a severity,
 * the record and one sentence. The build fails on any finding of severity
 * error.
 *
 * A rule declares which stage it runs in. `needs: 'parsed'` rules see records
 * as authored; `needs: 'resolved'` rules also see intervals and the derived
 * basis. Slice 2 builds the register and three rules; the runner that walks
 * them lands with resolve in slice 4.
 *
 * The three rules here read the same predicates the schema-level checks read,
 * so a record can never be reported by one and accepted by the other for the
 * same reason.
 */

import {
  deriveBasis,
  isBasisUpgrade,
  type BasisValue,
  type ConfidenceValue,
  type VerificationValue
} from './basis.ts';
import {
  basisOverrideGaps,
  basisOverridePair,
  missingSourceCitation,
  REQUIRED_SOURCE_KINDS
} from './envelope.ts';
import type { ConvertedExceptions } from './exceptions.ts';

/** Records as parsed, keyed by kind. */
export type ParsedRecords = Readonly<Record<string, readonly { id: string }[]>>;

/** One finding from one rule about one record. */
export interface Finding {
  rule: string;
  severity: 'error' | 'warning';
  record?: { kind: string; id: string };
  message: string;
}

/** What every rule is given. Built once per validate call. */
export interface RuleContext {
  readonly records: ParsedRecords;
  readonly exceptions: ConvertedExceptions;
  /** Kind names whose schema carries the claim envelope. */
  readonly claimKinds: ReadonlySet<string>;
}

/**
 * A validator. `needs` says which stage it runs in: 'parsed' rules see records
 * as authored, 'resolved' rules also see intervals and derived basis.
 */
export interface Rule {
  id: string;
  title: string;
  layer: 'kernel' | 'atlas' | 'deployment';
  severity: 'error' | 'warning';
  needs: 'parsed' | 'resolved';
  run(ctx: RuleContext): Finding[];
}

/** Every record of one kind, as authored, with the fields a rule reads. */
type LooseRecord = {
  id?: unknown;
  sources?: unknown[];
  confidence?: unknown;
  verification?: unknown;
  basis?: unknown;
  review?: unknown;
  reasoning?: unknown;
  falsifiable_by?: unknown;
  basis_override_reason?: unknown;
  tier?: unknown;
};

function rows(ctx: RuleContext, kind: string): LooseRecord[] {
  return (ctx.records[kind] ?? []) as unknown as LooseRecord[];
}

function kinds(ctx: RuleContext): string[] {
  return Object.keys(ctx.records);
}

function idOf(record: LooseRecord): string {
  return typeof record.id === 'string' ? record.id : '';
}

// ---------------------------------------------------------------------------------------------
// V12: a claim record cites at least one source, or is registered as not yet
// ---------------------------------------------------------------------------------------------

export const V12: Rule = Object.freeze({
  id: 'V12',
  title: 'Every claim record cites at least one source, or is a live exception',
  layer: 'kernel',
  severity: 'error',
  needs: 'parsed',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const kind of kinds(ctx)) {
      if (!REQUIRED_SOURCE_KINDS.has(kind)) continue;
      for (const record of rows(ctx, kind)) {
        if (!missingSourceCitation(kind, { id: idOf(record), sources: record.sources }, ctx.exceptions)) {
          continue;
        }
        findings.push({
          rule: 'V12',
          severity: 'error',
          record: { kind, id: idOf(record) },
          message:
            'every claim record must cite at least one source, or be listed in the exception register with an owner and a deadline'
        });
      }
    }
    return findings;
  }
});

// ---------------------------------------------------------------------------------------------
// V25: grade A means a primary record, not "we are confident"
// ---------------------------------------------------------------------------------------------

/** A source's tier by id, read from the parsed source register. */
function tierById(ctx: RuleContext): Map<string, number> {
  const tiers = new Map<string, number>();
  for (const source of rows(ctx, 'source')) {
    if (typeof source.id === 'string' && typeof source.tier === 'number') {
      tiers.set(source.id, source.tier);
    }
  }
  return tiers;
}

export const V25: Rule = Object.freeze({
  id: 'V25',
  title: 'A grade-A claim record cites a tier-1 or tier-2 source, or is a live exception',
  layer: 'kernel',
  severity: 'error',
  needs: 'parsed',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const tiers = tierById(ctx);
    for (const kind of kinds(ctx)) {
      if (kind === 'source') continue;
      for (const record of rows(ctx, kind)) {
        if (record.confidence !== 'A') continue;
        const cited = (record.sources ?? []).filter((id): id is string => typeof id === 'string');
        const citedTiers = cited
          .map((id) => tiers.get(id))
          .filter((tier): tier is number => typeof tier === 'number');
        if (citedTiers.some((tier) => tier <= 2)) continue;

        const key = `${kind}:${idOf(record)}`;
        if (ctx.exceptions.gradeAPrimary.has(key)) {
          const authored = record.basis as BasisValue | undefined;
          if (deriveBasis('A', record.verification as VerificationValue, authored) === 'reported') {
            findings.push({
              rule: 'V25',
              severity: 'warning',
              record: { kind, id: idOf(record) },
              message:
                'grade A with a reported kind and no tier-1/2 source (V26): the exception is live, but the claim reads stronger than its evidence'
            });
          }
          continue;
        }

        const shown = citedTiers.length
          ? `tier ${[...new Set(citedTiers)].sort().join('/')}`
          : 'no resolvable source tier';
        findings.push({
          rule: 'V25',
          severity: 'error',
          record: { kind, id: idOf(record) },
          message: `grade A must cite at least one tier-1 or tier-2 source (V25); it cites ${shown} and is not listed in the exception register`
        });
      }
    }
    return findings;
  }
});

// ---------------------------------------------------------------------------------------------
// V27: an authored basis stronger than the grade implies owes its provenance
// ---------------------------------------------------------------------------------------------

export const V27: Rule = Object.freeze({
  id: 'V27',
  title: 'A basis override carries a review, reasoning, a falsifier where owed, a source and a reason',
  layer: 'kernel',
  severity: 'error',
  needs: 'parsed',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const kind of kinds(ctx)) {
      if (!ctx.claimKinds.has(kind)) continue;
      for (const record of rows(ctx, kind)) {
        if (!record.basis || !record.confidence) continue;
        const derived = deriveBasis(
          record.confidence as ConfidenceValue,
          record.verification as VerificationValue,
          undefined
        );
        if (!isBasisUpgrade(record.basis as BasisValue, derived)) continue;
        const key = `${kind}:${idOf(record)}:${derived}>${String(record.basis)}`;
        if (ctx.exceptions.basisOverrides.has(key)) continue;
        const pair = basisOverridePair(record, derived);
        for (const missing of basisOverrideGaps(record, derived)) {
          findings.push({
            rule: 'V27',
            severity: 'error',
            record: { kind, id: idOf(record) },
            message: `${pair}: ${missing}`
          });
        }
      }
    }
    return findings;
  }
});

/** The kernel rules, in register order. */
export const KERNEL_RULES: readonly Rule[] = Object.freeze([V12, V25, V27]);
