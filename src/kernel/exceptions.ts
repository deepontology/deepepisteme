/**
 * kernel/exceptions.ts: the dated escape register.
 *
 * A rule may be broken on purpose, by name and until a date. Two shapes:
 *
 *   EnvelopeExceptions  what the schema-time envelope needs: which empty source
 *                       lists and which basis overrides are live. Keys are
 *                       `${kind}:${id}` and `${kind}:${id}:${derived}>${authored}`.
 *   ExceptionRegister   the 1.0 register: source exceptions with an owner, a
 *                       deadline and a reason, plus basis overrides. parse()
 *                       takes one and converts it once per call.
 *
 * Both are values. They are passed in, never installed through a configure
 * call, so two engines cannot see each other's escapes.
 */

/** Live escapes for withClaimEnvelope, keyed as the envelope documents. */
export interface EnvelopeExceptions {
  /** `${kind}:${id}` whose empty `sources` list is a live escape. */
  emptySources?: ReadonlySet<string>;
  /** `${kind}:${id}:${derived}>${authored}` basis overrides awaiting review. */
  basisOverrides?: ReadonlySet<string>;
}

/** The dated escape register: records allowed to break a named rule until a date. */
export interface ExceptionRegister {
  /**
   * Key: `${kind}:${id}`. `rule` is the register's own name for the broken
   * rule: no-source, grade-a-primary or basis-override.
   */
  sourceExceptions: ReadonlyMap<string, { rule: string; expires: string; reason: string }>;
  /**
   * Key: `${kind}:${id}:${derived}>${authored}`, the form the envelope reads.
   * The key carries the pair because the value does not: an override is the
   * combination of the implied basis and the authored one, not either alone.
   */
  basisOverrides: ReadonlyMap<string, { reason: string; source: string; expires?: string }>;
}

/** One register entry that no longer counts, kept so the caller can report it. */
export interface ExpiredException {
  /** The register key. */
  key: string;
  /** The register's rule name. */
  rule: string;
  /** The rule id a finding should cite: V12, V25, V27, or V19 for an unknown name. */
  findingRule: string;
  /** The record the entry meant to excuse, when the key names one. */
  record?: { kind: string; id: string };
  /** Why it no longer counts: the deadline, or a key that is not a date. */
  detail: string;
}

/**
 * The two key sets the envelope reads, plus what the register says that the
 * envelope does not read: the V25 escapes and the entries that died.
 */
export interface ConvertedExceptions extends EnvelopeExceptions {
  /** `${kind}:${id}` whose empty sources list is live. */
  emptySources: ReadonlySet<string>;
  /** `${kind}:${id}:${derived}>${authored}` overrides that are live. */
  basisOverrides: ReadonlySet<string>;
  /** `${kind}:${id}` whose grade-A primary-source check is waived (V25). */
  gradeAPrimary: ReadonlySet<string>;
  /** Entries dropped because the deadline passed before the cutoff. */
  expired: readonly ExpiredException[];
}

export const NO_EXCEPTIONS: ConvertedExceptions = Object.freeze({
  emptySources: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  basisOverrides: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  gradeAPrimary: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  expired: Object.freeze([]) as readonly ExpiredException[]
});

const RULE_IDS: Readonly<Record<string, string>> = {
  'no-source': 'V12',
  'grade-a-primary': 'V25',
  'basis-override': 'V27'
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The last millisecond of an ISO day, or NaN when the text is not one. */
function endOfDay(value: string): number {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return Number.NaN;
  const [y, m, d] = value.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return Number.NaN;
  }
  return t;
}

/**
 * An entry is live while its deadline day has not ended before `cutoff`. The
 * cutoff is the engine's certainty horizon, so the answer is a pure function of
 * the register and the deployment, with no clock read anywhere.
 */
function live(expires: string, cutoff: number): boolean {
  const end = endOfDay(expires);
  return !Number.isNaN(end) && end >= cutoff;
}

function recordOf(key: string): { kind: string; id: string } | undefined {
  const [kind, id] = key.split(':');
  if (!kind || !id) return undefined;
  return { kind, id };
}

/**
 * Convert one register into the shape the pipeline reads. Called once per
 * parse; an expired entry never silences anything and is reported instead.
 */
export function convertRegister(
  register: ExceptionRegister | undefined,
  cutoff: number
): ConvertedExceptions {
  if (!register) return NO_EXCEPTIONS;

  const emptySources = new Set<string>();
  const gradeAPrimary = new Set<string>();
  const basisOverrides = new Set<string>();
  const expired: ExpiredException[] = [];

  for (const [key, entry] of register.sourceExceptions ?? []) {
    if (!live(entry.expires, cutoff)) {
      const record = recordOf(key);
      expired.push({
        key,
        rule: entry.rule,
        findingRule: RULE_IDS[entry.rule] ?? 'V19',
        ...(record ? { record } : {}),
        detail: ISO_DAY.test(entry.expires)
          ? `the deadline ${entry.expires} passed`
          : `the deadline "${entry.expires}" is not an ISO date`
      });
      continue;
    }
    if (entry.rule === 'no-source') emptySources.add(key);
    else if (entry.rule === 'grade-a-primary') gradeAPrimary.add(key);
  }

  for (const [key, entry] of register.basisOverrides ?? []) {
    const expires = entry.expires;
    if (expires !== undefined && !live(expires, cutoff)) {
      const record = recordOf(key);
      expired.push({
        key,
        rule: 'basis-override',
        findingRule: 'V27',
        ...(record ? { record } : {}),
        detail: ISO_DAY.test(expires)
          ? `the deadline ${expires} passed`
          : `the deadline "${expires}" is not an ISO date`
      });
      continue;
    }
    basisOverrides.add(key);
  }

  return Object.freeze({
    emptySources: Object.freeze(emptySources) as ReadonlySet<string>,
    basisOverrides: Object.freeze(basisOverrides) as ReadonlySet<string>,
    gradeAPrimary: Object.freeze(gradeAPrimary) as ReadonlySet<string>,
    expired: Object.freeze(expired) as readonly ExpiredException[]
  });
}
