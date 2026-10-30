import { z } from 'zod';
import { chatChipSchema } from './attach.ts';
import { AUTO_MARK_IDS, type AutoMark } from './marks.ts';

/** A run's scope as the run dialog and the chat's run card send it. */
export const runScopeSchema = z.object({
  groupIds: z.array(z.string()).optional(),
  unitIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  marks: z.array(z.enum(AUTO_MARK_IDS as [AutoMark, ...AutoMark[]])).optional(),
  statusIds: z.array(z.string()).optional(),
  termIds: z.array(z.string()).optional(),
  speakers: z.array(z.string()).optional(),
  listeners: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
  q: z.string().optional(),
});

/** The part of a preflight the run card shows (and starts with): kept on the card, so the card says what it said when it was made. */
export const runCardPlanSchema = z.object({
  lines: z.object({ total: z.number(), excluded: z.number() }),
  totals: z.object({ calls: z.object({ min: z.number(), expected: z.number().nullable(), max: z.number() }) }),
  pace: z.object({ seconds: z.number().nullable(), costUsd: z.number().nullable(), subscription: z.boolean() }),
  suggestedLimits: z.object({ maxCalls: z.number().optional(), maxInputTokens: z.number().optional() }).optional(),
});
export type RunCardPlan = z.infer<typeof runCardPlanSchema>;

/**
 * An "실행 확인" card of the project chat (docs/CHAT-INPUT-DESIGN.md 3-2). It is a message of the
 * conversation record (a user message with one `data-run` part), so every window shows it where it
 * was made and the chat's agent reads it as something the user did.
 */
export const RUN_CARD_PART = 'data-run' as const;
export const RUN_CARD_STATES = ['pending', 'started', 'cancelled'] as const;
export const runCardSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  input: z.enum(['lines', 'terms']),
  /** What the person picked: the card shows it and does not change it (cancel and start again to change the target). */
  chips: z.array(chatChipSchema),
  scope: runScopeSchema,
  plan: runCardPlanSchema,
  /** pending: waiting for 실행 or 취소; started: the run exists (runId); cancelled: nothing ran. */
  state: z.enum(RUN_CARD_STATES),
  runId: z.string().optional(),
  createdAt: z.number(),
});
export type RunCard = z.infer<typeof runCardSchema>;

/** The record message that holds a card (its id is the card's). */
export const runCardMessage = (card: RunCard) => ({ id: card.id, role: 'user' as const, metadata: { kind: 'run-card' }, parts: [{ type: RUN_CARD_PART, data: card }] });

/** The card a stored message holds, or null for any other message (or a malformed one). */
export function runCardOf(message: { parts?: readonly { type: string }[] }): RunCard | null {
  const part = message.parts?.find((item) => item.type === RUN_CARD_PART) as { data?: unknown } | undefined;
  if (!part) return null;
  const parsed = runCardSchema.safeParse(part.data);
  return parsed.success ? parsed.data : null;
}
