import { z } from 'zod';
import { modelChoiceSchema } from './model-choice.ts';
import { AI_PRESETS, type AiPresetId } from './presets.ts';
import { aiNodeConfigSchema, contextConfigSchema } from './workflow.ts';

/** The continuation's instructions until a person changes them (the input's layout is described in the prompt itself). */
export const COMPLETE_SYSTEM =
  'You continue a Korean game translation in a translator\'s editor. Reply with nothing but the Korean translation of the line: if the translator has started it (the text between <started> and </started>), your reply begins with exactly that text and goes on. Copy the format tokens exactly. Follow the glossary and the speech level. No labels, quotes, notes or explanations.';

/** An editor button's own part: its instructions and what of the line it shows the model, from its preset until changed. */
function editorButtonSchema(preset: AiPresetId) {
  const filled = AI_PRESETS[preset];
  return z
    .object({
      instructions: z.string().default(filled.instructions),
      include: aiNodeConfigSchema.shape.include.default(filled.include),
    })
    .prefault({});
}

/**
 * The editor's AI, per project. 'AI 번역' and '다듬기' share one model (any connection, a CLI too), one
 * context and one call time limit, and each has its instructions (from the AI 번역 / AI 다듬기 presets
 * until changed); together they make an ordinary AI node configuration, not a workflow's node. The
 * continuation (off by default) has its own API model, as it answers while the person types.
 * One time limit covers AI 번역, 다듬기 and 자연어로 정규식 만들기.
 */
export const editorAiSchema = z.object({
  model: aiNodeConfigSchema.shape.model.default({ connectionId: '', model: '' }),
  context: contextConfigSchema.prefault({}),
  /** How long the editor's AI (AI 번역, 다듬기, 자연어로 정규식 만들기) waits for an answer: a person is waiting. */
  timeoutSeconds: z.number().int().min(10).max(600).default(60),
  translate: editorButtonSchema('translate'),
  refine: editorButtonSchema('refine'),
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
      /** How long a line must stay open before it is asked by itself: lines passed with ↑↓ are not asked. */
      delayMs: z.number().int().min(0).max(5000).default(500),
    })
    .prefault({}),
});
export type EditorButton = 'translate' | 'refine';

/** A button's settings as the AI node they make: its preset's output, the shared model, context and time limit. */
export function editorNodeConfig(settings: z.infer<typeof editorAiSchema>, button: EditorButton) {
  const preset = AI_PRESETS[button];
  return aiNodeConfigSchema.parse({
    model: settings.model,
    instructions: settings[button].instructions,
    output: preset.output,
    fields: structuredClone(preset.fields),
    include: settings[button].include,
    context: settings.context,
    preset: button,
    // The node's own unit is whole minutes; the call itself waits timeoutSeconds.
    timeoutMinutes: Math.max(1, Math.ceil(settings.timeoutSeconds / 60)),
  });
}
export type EditorAi = z.infer<typeof editorAiSchema>;
export const DEFAULT_EDITOR_AI: EditorAi = editorAiSchema.parse({});
