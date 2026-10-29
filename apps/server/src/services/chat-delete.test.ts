import { expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { deleteChat } from './chat-delete.ts';
import { deletingChats, startTurn, turnStartedAt } from './chat-turns.ts';
import { runChatTurn } from './chat-run.ts';
import { memoryStore } from './secrets.ts';

it('aborts and waits for a turn before deleting its record, refusing queued turns', async () => {
  const db = openDatabase(':memory:');
  const { id: projectId } = db.insert(s.projects).values({ name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
  const chat = db.insert(s.chatSessions).values({ projectId, title: 'Chat' }).returning().get();
  const turn = startTurn(projectId, chat.id);
  try {
    const queued = runChatTurn({ db, secrets: memoryStore() }, chat, {});
    const refused = expect(queued).rejects.toThrow('삭제');
    const deletion = deleteChat(db, chat.id);
    expect(turn.signal.aborted).toBe(true);
    expect(deletingChats.has(chat.id)).toBe(true);
    expect(db.select().from(s.chatSessions).get()?.id).toBe(chat.id);
    expect(() => startTurn(projectId, chat.id)).toThrow('삭제');
    turn.end();
    await deletion; await refused;
    expect(db.select().from(s.chatSessions).all()).toEqual([]);
    expect(turnStartedAt(chat.id)).toBeNull();
    expect(deletingChats.has(chat.id)).toBe(false);
    await expect(runChatTurn({ db, secrets: memoryStore() }, chat, {})).rejects.toThrow('삭제');
  } finally { turn.end(); db.$client.close(); }
});
