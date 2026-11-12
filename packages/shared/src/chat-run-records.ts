import { z } from 'zod';
import { SUBJECTS } from './subject.ts';
import { chatChipSchema } from './attach.ts';
import { runScopeSchema } from './run-scope.ts';

/** The part of a preflight the run card shows (and starts with): kept on the card, so the card says what it said when it was made. */
export const runCardPlanSchema = z.object({
  lines: z.object({ total: z.number(), excluded: z.number() }),
  totals: z.object({ calls: z.object({ min: z.number(), expected: z.number().nullable(), max: z.number() }) }),
  pace: z.object({ seconds: z.number().nullable(), costUsd: z.number().nullable(), subscription: z.boolean(), unmeasured: z.array(z.string()).optional() }),
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
  input: z.enum(SUBJECTS),
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

/**
 * A run this conversation started has stopped: finished, cancelled, or paused by itself (a cap, repeated failures). A
 * message of the record like a card: the panel shows it where it landed, and the agent reads it with its next message,
 * so hearing of the end costs nothing and starts nothing. The numbers are as they were then; read_run has the rest.
 */
export const RUN_END_PART = 'data-run-end' as const;
export const runEndSchema = z.object({
  id: z.string(),
  runId: z.string(),
  workflowName: z.string(),
  subject: z.enum(SUBJECTS),
  status: z.enum(['completed', 'paused', 'cancelled']),
  total: z.number(),
  /** Lines (or terms) per state. */
  states: z.record(z.string(), z.number()),
  /** Why it paused. */
  notice: z.string().nullable(),
  at: z.number(),
});
export type RunEnd = z.infer<typeof runEndSchema>;

/** The record message that holds a run's end. */
export const runEndMessage = (end: RunEnd) => ({ id: end.id, role: 'user' as const, metadata: { kind: 'run-end' }, parts: [{ type: RUN_END_PART, data: end }] });

/** The run's end a stored message holds, or null for any other message (or a malformed one). */
export function runEndOf(message: { parts?: readonly { type: string }[] }): RunEnd | null {
  const part = message.parts?.find((item) => item.type === RUN_END_PART) as { data?: unknown } | undefined;
  if (!part) return null;
  const parsed = runEndSchema.safeParse(part.data);
  return parsed.success ? parsed.data : null;
}

/** A card or a run's end: part of the record, not of the exchange. It is never the reply being continued or the message being revised. */
export const isRunRecord = (message: { parts?: readonly { type: string }[] }) => Boolean(message.parts?.some((part) => part.type === RUN_CARD_PART || part.type === RUN_END_PART));
