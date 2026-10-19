import { z } from 'zod';
import { modelChoiceSchema } from './model-choice.ts';

/**
 * The editor's AI, per project: the continuation (off by default; an API
 * connection's model), the model for 'AI 번역' and '다듬기' (any connection, a CLI too), and how
 * many calls a day both make at most (free tiers cap requests per day).
 */
export const editorAiSchema = z.object({
  enabled: z.boolean().default(false),
  model: modelChoiceSchema.nullable().default(null),
  assistModel: modelChoiceSchema.nullable().default(null),
  dailyCap: z.number().int().min(1).max(100_000).default(200),
});
export type EditorAi = z.infer<typeof editorAiSchema>;
export const DEFAULT_EDITOR_AI: EditorAi = editorAiSchema.parse({});
