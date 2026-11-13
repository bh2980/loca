import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { runEndMessage, runEndSchema } from '@loca/shared';
import type { Db } from '../db/index.ts';
import { perDatabase } from '../db/per-database.ts';
import * as s from '../db/schema.ts';
import { runRows } from './run-rows.ts';

/** Who hears that a conversation's run stopped (app.ts: the chat, to report it). */
const runEndListeners = perDatabase(() => new Set<(sessionId: string, runId: string, status: string) => void>());

export function onRunEnded(db: Db, listener: (sessionId: string, runId: string, status: string) => void) {
  const set = runEndListeners(db);
  set.add(listener);
  return () => void set.delete(listener);
}

/**
 * A run that a conversation started has stopped (finished, cancelled, or paused by itself): one message goes into that
 * conversation's record and tells the listeners; the chat (app.ts) then starts a turn so the agent reports the result.
 * A run started elsewhere (the run dialog, the terminal) has no conversation and records nothing.
 */
export function recordRunEnd(db: Db, runId: string) {
  const run = db.select({ projectId: s.runs.projectId, sessionId: s.runs.sessionId }).from(s.runs).where(eq(s.runs.id, runId)).get();
  if (!run?.sessionId) return;
  const session = db.select({ messages: s.chatSessions.messages }).from(s.chatSessions).where(eq(s.chatSessions.id, run.sessionId)).get();
  if (!session) return;
  const row = runRows(db, run.projectId, [runId])[0];
  const end = runEndSchema.safeParse({ id: crypto.randomUUID(), runId, workflowName: row?.workflowName, subject: row?.subject, status: row?.status, total: row?.total, states: row?.states, notice: row?.notice ?? null, at: Date.now() });
  if (!end.success) return;
  // Read and written with no await in between: a reply saving its own messages keeps this one (withStoredCards).
  db.update(s.chatSessions).set({ messages: [...(session.messages as UIMessage[]), runEndMessage(end.data) as unknown as UIMessage] }).where(eq(s.chatSessions.id, run.sessionId)).run();
  for (const listener of runEndListeners(db)) listener(run.sessionId, runId, end.data.status);
}
