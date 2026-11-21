/**
 * time.ts: the v0.1 time module, now a thin view of one Time object.
 *
 * The resolver lives in kernel/time.ts and holds its configuration in a
 * closure. This module keeps the old import path working by holding one Time
 * and delegating to it. configureTime replaces that object; nothing else here
 * has behaviour of its own.
 *
 * removed in slice 3
 */

import {
  createTime,
  ONGOING_CONFIRMATION_DAYS,
  type IntervalStatus,
  type Precision,
  type ResolvedInterval,
  type ResolveOptions,
  type Time,
  type TimeParameters
} from './kernel/time.ts';
import { getParameters } from './parameters.ts';
import { legacyEngine } from './legacy.ts';

export { ONGOING_CONFIRMATION_DAYS };
export type { IntervalStatus, Precision, ResolvedInterval, TimeParameters };

let active: Time = legacyEngine.time;

export function configureTime(p: TimeParameters): void {
  active = createTime(p);
}

export function configureTimeFromActive(): void {
  configureTime(getParameters().time);
}

export function parseDateEdge(input: string) {
  return active.parseDateEdge(input);
}

export function resolveInterval(
  spec: { start?: string | null; end?: string | null },
  opts?: ResolveOptions
): ResolvedInterval {
  return active.resolveInterval(spec.start ?? undefined, spec.end ?? undefined, opts);
}

export function applyOngoingObservation(
  iv: ResolvedInterval,
  lastObservation: number | null
): ResolvedInterval {
  return active.applyOngoingObservation(iv, lastObservation);
}

export function certainlyActive(iv: ResolvedInterval, t: number): boolean {
  return active.certainlyActive(iv, t);
}

export function possiblyActive(iv: ResolvedInterval, t: number): boolean {
  return active.possiblyActive(iv, t);
}

export function durationYears(iv: ResolvedInterval): number {
  return active.durationYears(iv);
}

export function getCutoff(): number {
  return active.cutoff;
}

export function getFloor(): number {
  return active.floor;
}

export function getBeforeWindowYears(): number {
  return active.beforeWindowYears;
}

export function getApproxSlackDays(): { year: number; month: number } {
  return { ...active.approxSlackDays };
}
