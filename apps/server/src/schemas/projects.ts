import { z } from 'zod';
import { DEFAULT_TAG_COLOR, HEX_COLOR, STATUS_COLORS, TAG_SCOPES } from '@tw/shared';

// Request bodies for statuses and tags, shared by the routes and the agent tools.
export const statusInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(HEX_COLOR).default(STATUS_COLORS[0]), kind: z.enum(['initial', 'normal', 'final']).default('normal'), inReview: z.boolean().default(false), humanOnly: z.boolean().default(false) });
export const tagInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(HEX_COLOR).default(DEFAULT_TAG_COLOR),
  /** Where the tag can be put; at least one place. */
  scope: z.array(z.enum(TAG_SCOPES)).min(1).refine((scope) => new Set(scope).size === scope.length, '같은 곳이 두 번 나옵니다.').default([...TAG_SCOPES]),
});
