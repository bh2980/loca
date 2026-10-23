import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { stopTurn } from './chat-turns.ts';
import { hasUnreportedDecisions, takeDecisions } from './proposals.ts';

/**
 * What reaches a running turn from outside its model: messages the person sent meanwhile (#44)
 * and how its proposals were decided (#43). Each backend takes them at turn start and at every step
 * boundary, writes them into the reply where they came in (a `data-steer` part, see
 * chat-context.ts expandSteers) and hands them to the model as a user message.
 */
export interface Interjection {
  text: string;
  kind: 'user' | 'decisions';
}

/**
 * Messages sent while a turn is running (#44). The running turn hands them to its model at the next
 * step boundary (after a tool result, or when it would otherwise stop); what a turn could not take
 * (it stopped for a tool approval) waits for the next turn. Stored on the conversation, so neither
 * the gap between two turns nor a server restart loses them.
 */
const pendingOf = (db: Db, sessionId: string) => db.select({ pending: s.chatSessions.pendingSteers }).from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get()?.pending ?? [];

export function enqueueSteer(db: Db, sessionId: string, text: string) {
  db.transaction((tx) => {
    const pending = tx.select({ pending: s.chatSessions.pendingSteers }).from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get()?.pending ?? [];
    tx.update(s.chatSessions).set({ pendingSteers: [...pending, text] }).where(eq(s.chatSessions.id, sessionId)).run();
  });
}

/** Takes one queued message back (the person cancelled or is editing it). False: the turn already took it. */
export function dequeueSteer(db: Db, sessionId: string, text: string) {
  return db.transaction((tx) => {
    const pending = tx.select({ pending: s.chatSessions.pendingSteers }).from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get()?.pending ?? [];
    const at = pending.indexOf(text);
    if (at < 0) return false;
    tx.update(s.chatSessions).set({ pendingSteers: pending.filter((_, i) => i !== at) }).where(eq(s.chatSessions.id, sessionId)).run();
    return true;
  });
}

/** The queued messages, removed from the queue (the caller hands them to the model). */
export function takeSteers(db: Db, sessionId: string) {
  return db.transaction((tx) => {
    const pending = tx.select({ pending: s.chatSessions.pendingSteers }).from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get()?.pending ?? [];
    if (pending.length) tx.update(s.chatSessions).set({ pendingSteers: [] }).where(eq(s.chatSessions.id, sessionId)).run();
    return pending;
  });
}

export const hasSteers = (db: Db, sessionId: string) => pendingOf(db, sessionId).length > 0;

/** Stops the running turn (if any); the messages no turn took go back to the person (the input box). */
export function stopWithQueued(db: Db, sessionId: string) {
  return { stopped: stopTurn(sessionId), queued: takeSteers(db, sessionId) };
}

/** Takes (and marks as told) everything waiting for the conversation's agent. */
export function takeInterjections(db: Db, sessionId: string): Interjection[] {
  const decisions = takeDecisions(db, sessionId);
  return [...takeSteers(db, sessionId).map((text) => ({ text, kind: 'user' as const })), ...(decisions ? [{ text: decisions, kind: 'decisions' as const }] : [])];
}

export const hasInterjections = (db: Db, sessionId: string) => hasSteers(db, sessionId) || hasUnreportedDecisions(db, sessionId);

/** How interjections read to the model. Empty when there are none. */
export function interjectionPrompt(items: Interjection[]) {
  const said = items.filter((item) => item.kind === 'user').map((item) => item.text);
  return [said.length ? `사용자가 진행 중에 보낸 메시지(지금 하던 일보다 우선합니다):\n${said.join('\n\n')}` : '', ...items.filter((item) => item.kind === 'decisions').map((item) => item.text)].filter(Boolean).join('\n\n');
}

/** Records the interjections in the reply being written and returns them as prompt text. */
export function writeInterjections(writer: { write: (chunk: { type: 'data-steer'; data: Interjection }) => void }, items: Interjection[]) {
  for (const item of items) writer.write({ type: 'data-steer', data: item });
  return interjectionPrompt(items);
}
