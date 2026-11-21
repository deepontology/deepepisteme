/**
 * atlas/kinds/group-layer.ts: the subsections of the network view.
 *
 * Not a claim record: a presentation layer over the graph. Each layer gets
 * an ordered list of subsections; a subsection defines a header and a
 * membership rule, and the first rule that matches wins. An entity matching
 * no rule falls into an auto-appended "Other" bucket, so nothing is dropped —
 * which is why a membership rule with no matcher at all is refused.
 *
 * Ported from the consumer's schema.
 */

import { z } from 'zod';
import type { AtlasLiterals } from './index.ts';

/** One membership rule — an entity matches if ANY rule in the list matches. */
const MembershipRule = z
  .strictObject({
    role: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    role_prefix: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    type: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    members: z.array(z.string()).min(1).optional()
  })
  .refine((r) => r.role || r.role_prefix || r.type || r.members, {
    message: 'membership rule must have at least one of: role, role_prefix, type, members'
  });

const GroupDefSchema = z.strictObject({
  header_en: z.string().min(1),
  header_fr: z.string().optional(),
  header_ar: z.string().optional(),
  membership: MembershipRule
});

/** The group-layer kind's schema. Not claim-bearing: no envelope is applied to it. */
export function groupLayerSchema(l: AtlasLiterals) {
  return z.strictObject({
    layer: z.enum(l.layers as unknown as [string, ...string[]]),
    subsections: z.array(GroupDefSchema).min(1)
  });
}
