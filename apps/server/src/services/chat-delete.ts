import { eq } from 'drizzle-orm';
import { badRequest } from '../refusal.ts';
import { closeSession } from '@tw/ai';
import type { Db } from '../db/index.ts';
import { chatSessions } from '../db/schema.ts';
import { deletingChats, stopTurn, turnEnded } from './chat-turns.ts';
import { disposeChatServer } from './cli-chat.ts';

/** Stop work before deleting its record, including queued turns and the CLI tool host. */
export async function deleteChat(db: Db, sessionId: string) {
  if (deletingChats.has(sessionId)) badRequest('삭제 중인 대화입니다.');
  const chat = db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).get();
  if (!chat) return;
  deletingChats.add(sessionId);
  try {
    stopTurn(sessionId);
    if (!await turnEnded(sessionId, 30_000)) badRequest('대화가 아직 종료되지 않았습니다. 잠시 후 다시 삭제하세요.');
    const current = db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).get();
    if (current?.agentSession) await closeSession(current.agentSession.id);
    await disposeChatServer(sessionId);
    db.delete(chatSessions).where(eq(chatSessions.id, sessionId)).run();
  } finally {
    deletingChats.delete(sessionId);
  }
}
