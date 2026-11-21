/**
 * kernel/basis.ts: the grade ladder and how a basis is derived from it.
 *
 * Basis answers "what KIND of claim is this?", not "how strong is it?".
 * A reasoned inference and a thinly-sourced report are both weak, but weak in
 * completely different ways. Collapsing them is how a project quietly becomes
 * a rumour mill.
 *
 *   documented       An official record states this.
 *   reported         Credible publications report it; attributed, not verified.
 *   inferred         Nobody states this directly; reasoned from structure.
 *   unsubstantiated  Circulates without reliable evidence. Kept, not deleted.
 */

import { z } from 'zod';

export const Confidence = z.enum(['A', 'B', 'C', 'D']);
export const Basis = z.enum(['documented', 'reported', 'inferred', 'unsubstantiated']);
/**
 * Where a claim sits in the research pipeline. 1.0 adds `unflagged`, the
 * absence of an editorial check, and makes it the default on every claim kind.
 * It moves the basis exactly as `verified` does: the missing check is not a
 * weaker kind of claim.
 */
export const Verification = z.enum(['unflagged', 'verified', 'needs-primary-source', 'disputed']);

export type ConfidenceValue = z.infer<typeof Confidence>;
export type BasisValue = z.infer<typeof Basis>;
export type VerificationValue = z.infer<typeof Verification>;

const BASIS_STRENGTH: Record<BasisValue, number> = {
  unsubstantiated: 0,
  inferred: 1,
  reported: 2,
  documented: 3
};

/** True when `authored` claims more epistemic standing than `derived`. */
export function isBasisUpgrade(authored: BasisValue, derived: BasisValue): boolean {
  return BASIS_STRENGTH[authored] > BASIS_STRENGTH[derived];
}

export function deriveBasis(
  confidence: ConfidenceValue,
  verification: VerificationValue,
  explicit?: BasisValue
): BasisValue {
  if (explicit) return explicit;
  if (confidence === 'A') return 'documented';
  if (confidence === 'D') return 'unsubstantiated';
  if (confidence === 'C' && verification === 'needs-primary-source') return 'inferred';
  return 'reported';
}
