import { z } from 'zod';
import { chatChipSchema } from './attach.ts';
import { KNOWLEDGE_STATUSES } from './knowledge.ts';
import { DECIDED_BY, TERM_MARK_IDS, type AutoMark } from './marks.ts';
import { filterList, resolvedLineFilterSchema, some, unpagedLineFilterSchema, type Some } from './script.ts';

const termMark = z.enum(TERM_MARK_IDS as Some<AutoMark>);

/** Which terms a run of a terms workflow takes, as asked: terms by id or source, statuses by label or id, tags by name or id. */
export const runTermsInputSchema = z
  .object({
    terms: filterList(z.string().min(1)).optional(),
    /** 후보 / 확정 / 버림 (or candidate / confirmed / rejected). None: every term not rejected. */
    statuses: filterList(z.string().min(1)).optional(),
    /** Term marks the terms must all have. */
    marks: filterList(termMark).optional(),
    /** Tags the terms must all carry. */
    tags: filterList(z.string().min(1)).optional(),
    /** Who decided the term (정한 쪽). */
    decidedBy: z.enum(DECIDED_BY).optional(),
    /** Terms with no Korean form (true) or with one (false). */
    emptyTarget: z.boolean().optional(),
  })
  .strict();
export type RunTermsInput = z.infer<typeof runTermsInputSchema>;

/** The same with its names resolved; like a resolved line filter, a list is absent or holds something. */
export const runTermsSchema = z
  .object({
    ids: some(z.string()).optional(),
    statuses: some(z.enum(KNOWLEDGE_STATUSES)).optional(),
    marks: some(termMark).optional(),
    tagIds: some(z.string()).optional(),
    decidedBy: z.enum(DECIDED_BY).optional(),
    emptyTarget: z.boolean().optional(),
    /** No term can match. */
    nothing: z.literal(true).optional(),
  })
  .strict();
export type RunTerms = z.infer<typeof runTermsSchema>;

/**
 * What a run is asked to run on, in names: the run dialog, the chat's plan_run / start_run and `loca runs plan / start`
 * all send this. A lines workflow takes `filter` (the line filter, as the script list and `loca lines` take it), a terms
 * workflow `terms`; the other one is refused. The server resolves it (resolveRunScope) into the scope the run stores.
 */
export const runScopeInputSchema = z
  .object({
    filter: unpagedLineFilterSchema.optional(),
    terms: runTermsInputSchema.optional(),
    /**
     * Also change what a person decided: a status a person set and tags a person put on (the line's history says who
     * did it last). Off: the run leaves them and says so in its detail.
     */
    changeHuman: z.boolean().optional(),
  })
  .strict();
export type RunScopeInput = z.infer<typeof runScopeInputSchema>;

/** A run's scope as it is stored and run (runs.scope, a run card): the resolved filter of a lines run, or the terms of a terms run. Neither: every line (or term). */
export const runScopeSchema = z
  .object({
    filter: resolvedLineFilterSchema.optional(),
    terms: runTermsSchema.optional(),
    changeHuman: z.boolean().optional(),
  })
  .strict();
export type RunScope = z.infer<typeof runScopeSchema>;

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
  subject: z.enum(['lines', 'terms']),
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
