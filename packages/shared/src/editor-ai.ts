import { z } from 'zod';
import { modelChoiceSchema } from './model-choice.ts';

/**
 * The editor's AI continuation (docs/DESIGN.md J3b A), per project: off by default; an API
 * connection's model; how many calls a day at most (free tiers cap requests per day).
 */
export const editorAiSchema = z.object({
  enabled: z.boolean().default(false),
  model: modelChoiceSchema.nullable().default(null),
  dailyCap: z.number().int().min(1).max(100_000).default(200),
});
export type EditorAi = z.infer<typeof editorAiSchema>;
export const DEFAULT_EDITOR_AI: EditorAi = editorAiSchema.parse({});
