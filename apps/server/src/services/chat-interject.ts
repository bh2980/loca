import type { Db } from '../db/index.ts';
import { hasSteers, takeSteers } from './chat-turns.ts';
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

/** Takes (and marks as told) everything waiting for the conversation's agent. */
export function takeInterjections(db: Db, sessionId: string): Interjection[] {
  const decisions = takeDecisions(db, sessionId);
  return [...takeSteers(sessionId).map((text) => ({ text, kind: 'user' as const })), ...(decisions ? [{ text: decisions, kind: 'decisions' as const }] : [])];
}

export const hasInterjections = (db: Db, sessionId: string) => hasSteers(sessionId) || hasUnreportedDecisions(db, sessionId);

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
