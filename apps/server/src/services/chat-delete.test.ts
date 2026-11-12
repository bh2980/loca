import { expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { deleteChat } from './chat-delete.ts';
import { chatDeleting, startTurn, turnStartedAt } from './chat-turn-registry.ts';
import { runChatTurn } from './chat-turn.ts';
import { memoryStore } from '../domain/secrets.ts';

it('aborts and waits for a turn before deleting its record, refusing queued turns', async () => {
  const db = openDatabase(':memory:');
  const { id: projectId } = db.insert(s.projects).values({ name: 'P', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
  const chat = db.insert(s.chatSessions).values({ projectId, title: 'Chat' }).returning().get();
  const turn = startTurn(db, projectId, chat.id);
  try {
    const queued = runChatTurn({ db, secrets: memoryStore() }, chat, {});
    const refused = expect(queued).rejects.toThrow('삭제');
    const deletion = deleteChat(db, chat.id);
    expect(turn.signal.aborted).toBe(true);
    expect(chatDeleting(db, chat.id)).toBe(true);
    expect(db.select().from(s.chatSessions).get()?.id).toBe(chat.id);
    expect(() => startTurn(db, projectId, chat.id)).toThrow('삭제');
    turn.end();
    await deletion; await refused;
    expect(db.select().from(s.chatSessions).all()).toEqual([]);
    expect(turnStartedAt(db, chat.id)).toBeNull();
    expect(chatDeleting(db, chat.id)).toBe(false);
    await expect(runChatTurn({ db, secrets: memoryStore() }, chat, {})).rejects.toThrow('삭제');
  } finally { turn.end(); db.$client.close(); }
});
