/**
 * atlas/rules: the rules about a map of power, in register order.
 *
 * One file per rule or small family; each family lands in its own pull
 * request, and the order here is the order findings are reported in.
 */

import type { Rule } from '../../kernel/rules.ts';
import { V1 } from './ownership-sum.ts';
import { V7 } from './board-overlap.ts';
import { V3 } from './company-registration.ts';
import { V4 } from './contract-award.ts';
import { V10 } from './place-geography.ts';
import { V16 } from './relationship-duplicates.ts';
import { V17 } from './event-rupture.ts';
import { V8 } from './event-causal.ts';
import { V11 } from './event-orphan.ts';

export const ATLAS_RULES: readonly Rule[] = Object.freeze([V4, V10, V16, V17, V8, V3, V11, V1, V7]);

export { V1, V3, V4, V7, V8, V10, V11, V16, V17 };
