import { z } from 'zod';

/**
 * Which AI a place of use calls: a connection, one of its models and a reasoning effort. Picked
 * where AI is used (chat, AI nodes, work analysis, glossary fill); how the call is made (time limit,
 * attempts, output cap, fallback) belongs to the connection.
 */
export const modelChoiceSchema = z.object({
  connectionId: z.string().min(1, 'AI 연결을 고르세요.'),
  model: z.string().trim().min(1, '모델을 고르세요.'),
  /** Empty = the model's default. */
  effort: z.string().optional(),
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

/** A choice not made yet (an AI node before the user picks): saved, but flagged by validation. */
export const draftModelChoiceSchema = z.object({ connectionId: z.string().default(''), model: z.string().default(''), effort: z.string().optional() });
export type DraftModelChoice = z.output<typeof draftModelChoiceSchema>;
export const EMPTY_MODEL_CHOICE = { connectionId: '', model: '' } as const;

/** One key per distinct choice: run snapshots and the runner's account bookkeeping are keyed by it. */
export const choiceKey = (choice: { connectionId: string; model: string; effort?: string | null }) => [choice.connectionId, choice.model, choice.effort ?? ''].join('|');
