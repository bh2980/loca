import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { runCardMessage, runCardOf, type ChatChip, type RunCard, type RunCardPlan } from '@loca/shared';
import { badRequest, found, notFound } from '../refusal.ts';
import type { Db } from '../db/index.ts';
import { perDatabase } from '../db/per-database.ts';
import * as s from '../db/schema.ts';
import { chatRunScope } from './chat-run-scope.ts';
import { preflight } from '../engine/preflight.ts';
import { planOf } from './run-plan.ts';
import { fitScope, startRun } from './start-run.ts';

/**
 * The 실행 확인 cards of the project chat (docs/CHAT-INPUT-DESIGN.md 3-2), kept in the conversation
 * record (`chat_sessions.messages`) as user messages with a `data-run` part: every window shows them
 * where they were made, and the agent reads them as something the user did (chat-record.ts).
 * The card is made with the numbers the person sees; 실행 starts the run with the card's own scope
 * and caps and records its runId in the same call, so the card and the run cannot drift.
 */

const record = (db: Db, sessionId: string) => found(db.select().from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get(), '대화');

/** Makes the card for the picks of a /workflow (the run dialog's scope and preflight) and adds it to the end of the conversation. */
export async function createRunCard(db: Db, sessionId: string, input: { workflowId: string; chips: ChatChip[] }): Promise<RunCard> {
  const session = record(db, sessionId);
  const resolved = chatRunScope(db, session.projectId, input.workflowId, input.chips);
  if (!resolved.ok) badRequest(resolved.error);
  const workflow = found(db.select().from(s.workflows).where(eq(s.workflows.id, input.workflowId)).get(), '워크플로');
  fitScope(workflow.definition, resolved.scope);
  let plan: RunCardPlan;
  try {
    plan = planOf((await preflight(db, workflow, resolved.scope)) as unknown as RunCardPlan);
  } catch (error) {
    badRequest(error instanceof Error ? error.message : String(error));
  }
  const card: RunCard = {
    id: crypto.randomUUID(),
    workflowId: workflow.id,
    workflowName: resolved.workflowName,
    input: resolved.input,
    chips: input.chips,
    scope: resolved.scope,
    plan,
    state: 'pending',
    createdAt: Date.now(),
  };
  // Read and written with no await in between: a reply that is saving its own messages cannot lose it (chat-stream keeps cards a reply did not know).
  const latest = record(db, sessionId);
  db.update(s.chatSessions).set({ messages: [...(latest.messages as UIMessage[]), runCardMessage(card) as unknown as UIMessage] }).where(eq(s.chatSessions.id, sessionId)).run();
  return card;
}

/** The caps a card starts its run with: the suggestion it was made with, as it showed them (none where it had none). */
const startLimits = (suggested: RunCardPlan['suggestedLimits']) => ({ maxCalls: suggested?.maxCalls ?? null, maxInputTokens: suggested?.maxInputTokens ?? null });

/** Cards being started right now (the run is made in steps): a second 실행 on the same card is refused instead of starting a second run. */
const starting = perDatabase(() => new Set<string>());

const replaceCard = (db: Db, sessionId: string, card: RunCard) => {
  const latest = record(db, sessionId);
  const messages = (latest.messages as UIMessage[]).map((message) => (message.id === card.id && runCardOf(message) ? (runCardMessage(card) as unknown as UIMessage) : message));
  db.update(s.chatSessions).set({ messages }).where(eq(s.chatSessions.id, sessionId)).run();
};

/**
 * 실행 or 취소 on a waiting card. Only pending → started | cancelled is allowed (409-like 400
 * otherwise, so two windows answering at once cannot both win). 실행 starts the run and records
 * its runId on the card in this one call.
 */
export async function answerRunCard(db: Db, sessionId: string, cardId: string, answer: 'start' | 'cancel'): Promise<RunCard> {
  const session = record(db, sessionId);
  const card = (session.messages as UIMessage[]).flatMap((message) => (message.id === cardId ? [runCardOf(message)] : [])).find(Boolean);
  if (!card) return notFound('실행 확인 카드');
  if (card.state !== 'pending' || starting(db).has(card.id)) badRequest(card.state === 'started' ? '이미 실행했습니다.' : card.state === 'cancelled' ? '이미 취소했습니다.' : '이 카드는 지금 실행을 시작하는 중입니다.');
  if (answer === 'cancel') {
    const next: RunCard = { ...card, state: 'cancelled' };
    replaceCard(db, sessionId, next);
    return next;
  }
  starting(db).add(card.id);
  try {
    const started = await startRun(db, { workflowId: card.workflowId, scope: { resolved: card.scope }, limits: startLimits(card.plan.suggestedLimits), sessionId });
    if (!started.ok) badRequest(started.error);
    const next: RunCard = { ...card, state: 'started', runId: started.runId };
    replaceCard(db, sessionId, next);
    return next;
  } finally {
    starting(db).delete(card.id);
  }
}

/** 감시 끊기: the conversation stops following this run; it goes on, and its end is no longer recorded or reported there. */
export function unwatchRun(db: Db, runId: string) {
  db.update(s.runs).set({ sessionId: null }).where(eq(s.runs.id, runId)).run();
}
