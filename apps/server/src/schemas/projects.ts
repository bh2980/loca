import { z } from 'zod';
import { DEFAULT_TAG_COLOR, HEX_COLOR, normalizeTagScopes, STATUS_COLORS, TAG_SCOPES, type TagScope } from '@tw/shared';

// Request bodies for statuses and tags, shared by the routes and the agent tools.
export const statusInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(HEX_COLOR).default(STATUS_COLORS[0]), kind: z.enum(['initial', 'normal', 'final']).default('normal'), inReview: z.boolean().default(false), humanOnly: z.boolean().default(false) });

const scopeInput = z.enum([...TAG_SCOPES, 'knowledge'] as const);

export const tagInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(HEX_COLOR).default(DEFAULT_TAG_COLOR),
  /** Where the tag can be put; at least one place. */
  scope: z
    .array(scopeInput)
    .min(1)
    .transform((scope) => normalizeTagScopes(scope))
    .refine((scope) => scope.length > 0, '적어도 한 곳은 골라야 합니다.')
    .default(['lines', 'terms', 'people', 'documents', 'events']),
});

