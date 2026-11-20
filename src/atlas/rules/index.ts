/**
 * atlas/rules: the rules about a map of power, in register order.
 *
 * One file per rule or small family; each family lands in its own pull
 * request, and the order here is the order findings are reported in.
 */

import type { Rule } from '../../kernel/rules.ts';
import { V4 } from './contract-award.ts';

export const ATLAS_RULES: readonly Rule[] = Object.freeze([V4]);

export { V4 };
