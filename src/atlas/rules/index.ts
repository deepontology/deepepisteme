/**
 * atlas/rules: the rules about a map of power, in register order.
 *
 * One file per rule or small family; each family lands in its own pull
 * request, and the order here is the order findings are reported in.
 */

import type { Rule } from '../../kernel/rules.ts';
import { V3 } from './company-registration.ts';
import { V4 } from './contract-award.ts';
import { V11 } from './event-orphan.ts';

export const ATLAS_RULES: readonly Rule[] = Object.freeze([V3, V4, V11]);

export { V3, V4, V11 };
