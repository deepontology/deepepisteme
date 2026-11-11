/**
 * kernel/exceptions.ts — the dated escape register.
 *
 * A rule may be broken on purpose, by name and until a date. Two shapes:
 *
 *   EnvelopeExceptions  what the schema-time envelope needs: which empty source
 *                       lists and which basis overrides are live. Keys are
 *                       `${kind}:${id}` and `${kind}:${id}:${derived}>${authored}`.
 *   ExceptionRegister   the 1.0 register: source exceptions with an owner, a
 *                       deadline and a reason, plus basis overrides. parse()
 *                       takes one; nothing reads it before slice 2.
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

export const NO_EXCEPTIONS: EnvelopeExceptions = Object.freeze({});

/** The dated escape register: records allowed to break a named rule until a date. */
export interface ExceptionRegister {
  sourceExceptions: ReadonlyMap<string, { rule: string; expires: string; reason: string }>;
  basisOverrides: ReadonlyMap<string, { reason: string; source: string; expires?: string }>;
}
