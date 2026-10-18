import { z } from 'zod';
import { AGE_BANDS, CHARACTER_ROLES, characterStyleSchema, DOCUMENT_KINDS, GENDERS, KNOWLEDGE_STATUSES, relationshipChangeSchema, SPEECH_LEVELS } from '@tw/shared';

// Request bodies for knowledge items, shared by the routes and the agent tools (services must not import routes).
export const termInput = z.object({
  source: z.string().trim().min(1),
  target: z.string().default(''),
  note: z.string().default(''),
  /** candidate = proposed (not used as context yet), confirmed = used by AI nodes. */
  status: z.enum(['candidate', 'confirmed']).default('confirmed'),
});
/** Editing a draft keeps it a candidate; confirming is a separate, explicit step. */
const status = z.enum(KNOWLEDGE_STATUSES).default('confirmed');
const evidence = z.array(z.string().min(1)).default([]);
export const documentInput = z.object({ kind: z.enum(DOCUMENT_KINDS).default('note'), title: z.string().trim().min(1), body: z.string().default(''), alwaysInclude: z.boolean().default(false), status });
export const characterInput = z.object({ name: z.string().trim().min(1), aliases: z.array(z.string().trim().min(1)).default([]), profile: z.string().default(''), speech: z.string().default(''), style: characterStyleSchema.default({}), gender: z.enum(GENDERS).default('unknown'), ageBand: z.enum(AGE_BANDS).default('unknown'), role: z.enum(CHARACTER_ROLES).default('unknown'), player: z.boolean().default(false), status });
export const relationshipInput = z.object({ fromId: z.string(), toId: z.string(), kind: z.string().trim().min(1), description: z.string().default(''), mutual: z.boolean().default(false), changes: z.array(relationshipChangeSchema).default([]), status });
export const eventInput = z.object({ title: z.string().trim().min(1), summary: z.string().default(''), cause: z.string().default(''), outcome: z.string().default(''), participants: z.array(z.string().trim().min(1)).default([]), evidence, status });
export const speechRuleInput = z.object({
  fromName: z.string().trim().min(1),
  toName: z.string().trim().min(1),
  level: z.enum(SPEECH_LEVELS),
  address: z.string().default(''),
  note: z.string().default(''),
  startKey: z.string().trim().min(1).nullable().default(null),
  evidence,
  status,
});
