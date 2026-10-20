import { z } from 'zod';
import { modelChoiceSchema } from './model-choice.ts';
import { AI_PRESETS, type AiPresetId } from './presets.ts';
import { aiNodeConfigSchema, contextConfigSchema } from './workflow.ts';

/** The continuation's instructions until a person changes them (the input's layout is described in the prompt itself). */
export const COMPLETE_SYSTEM =
  'You continue a Korean game translation in a translator\'s editor. Reply with nothing but the Korean translation of the line: if the translator has started it (the text between <started> and </started>), your reply begins with exactly that text and goes on. Copy the format tokens exactly. Follow the glossary and the speech level. No labels, quotes, notes or explanations.';

/**
 * An editor button's AI: an ordinary AI node configuration of its own (model, instructions, context,
 * call time limit), filled from a preset until a person changes it. It is not a workflow's node:
 * changing one does not change the other.
 */
function editorNodeSchema(preset: AiPresetId) {
  const filled = AI_PRESETS[preset];
  return aiNodeConfigSchema
    .extend({
      instructions: z.string().default(filled.instructions),
      output: aiNodeConfigSchema.shape.output.default(filled.output),
      fields: aiNodeConfigSchema.shape.fields.default(structuredClone(filled.fields)),
      include: aiNodeConfigSchema.shape.include.default(filled.include),
      context: contextConfigSchema.prefault((filled as { context?: object }).context ?? {}),
      preset: z.string().default(preset),
      // A person waits for the answer: a single line should not take minutes.
      timeoutMinutes: aiNodeConfigSchema.shape.timeoutMinutes.default(2),
    })
    .prefault({});
}

/**
 * The editor's AI, per project: the 'AI 번역' and '다듬기' buttons (each its own AI node settings, any
 * connection, a CLI too), the continuation (off by default; an API connection's model: it answers as
 * the person types), and 자연어로 정규식 만들기's time limit.
 */
export const editorAiSchema = z.object({
  translate: editorNodeSchema('translate'),
  refine: editorNodeSchema('refine'),
  complete: z
    .object({
      enabled: z.boolean().default(false),
      model: modelChoiceSchema.nullable().default(null),
      /** Calls it may make a day (it calls as the person types; the buttons only on a click). */
      dailyCap: z.number().int().min(1).max(100_000).default(200),
      instructions: z.string().default(COMPLETE_SYSTEM),
      /** Lines before it in the scene (with their translations). */
      precedingLines: z.number().int().min(0).max(20).default(3),
      glossary: z.boolean().default(true),
      /** Who says it to whom and the confirmed speech rule. */
      speech: z.boolean().default(true),
      /** A continuation later than this is no help while typing. */
      timeoutSeconds: z.number().int().min(3).max(120).default(15),
    })
    .prefault({}),
  regex: z.object({ timeoutSeconds: z.number().int().min(10).max(600).default(120) }).prefault({}),
});
export type EditorAi = z.infer<typeof editorAiSchema>;
export const DEFAULT_EDITOR_AI: EditorAi = editorAiSchema.parse({});
