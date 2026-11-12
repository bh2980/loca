import { z } from 'zod';
import { DEFAULT_TAG_COLOR, HEX_COLOR, orderedTagScopes, STATUS_COLORS, TAG_SCOPES } from '@loca/shared';

// Request bodies for statuses and tags, shared by the routes and the agent tools.
export const statusInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(HEX_COLOR).default(STATUS_COLORS[0]), kind: z.enum(['initial', 'normal', 'final']).default('normal'), inReview: z.boolean().default(false) });

export const tagInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(HEX_COLOR).default(DEFAULT_TAG_COLOR),
  /** What the tag is for, in a sentence (설명). */
  description: z.string().trim().max(300).default(''),
  /** Where the tag can be put; at least one place. */
  scope: z
    .array(z.enum(TAG_SCOPES))
    .min(1, '적어도 한 곳은 골라야 합니다.')
    .transform(orderedTagScopes)
    .default(['lines', 'terms', 'people', 'documents', 'events']),
});

