import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { compactionMarker, estimateTokens, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { compactNow, compactionSettled, cutPoint, fitRecord, KEEP_RECENT_TOKENS, withCompaction } from './chat-compaction.ts';
import { compactChat } from './chat-run.ts';
import { startTurn } from './chat-turns.ts';
import { importProject } from './importer.ts';
import { memoryStore } from './secrets.ts';

// Summaries go through the fake Grok CLI (scripts/fake-cli): no model is called.
const FAKE_GROK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts/fake-cli/grok');

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const reply = (id: string, text: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }] });
/** About `tokens` tokens of text (estimateTokens counts 4 bytes a token). */
const sized = (tokens: number) => 'x'.repeat(tokens * 4);

function setup(inputTokens: number) {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] }));
  const connection = db.insert(s.connections).values({ name: 'Grok', kind: 'grok', executable: FAKE_GROK, modelLimits: { fake: { contextWindow: inputTokens, by: 'api' } } }).returning().get();
  const chat = db.insert(s.chatSessions).values({ projectId, title: '대화' }).returning().get();
  const route = { kind: 'grok' as const, executable: FAKE_GROK, model: 'fake', connectionId: connection.id };
  return { db, chat, route };
}

const calls = (db: ReturnType<typeof setup>['db']) => db.select().from(s.aiCalls).all().filter((call) => call.label === '대화 압축').length;

describe('chat compaction (as pi does it)', () => {
  it('sends the whole record while it fits the model', async () => {
    const { db, chat, route } = setup(200_000);
    const record = [user('1', sized(20_000)), reply('2', sized(20_000)), user('3', '지금')];
    expect(await fitRecord({ db, chat, route, record, overhead: 5_000 })).toBe(record);
    expect(calls(db)).toBe(0);
  });

  it('keeps the newest part from a user message and summarizes the rest once, then reuses the summary', async () => {
    const { db, chat, route } = setup(60_000);
    const record = [user('1', sized(15_000)), reply('2', sized(15_000)), user('3', sized(8_000)), reply('4', sized(8_000)), user('5', sized(8_000)), reply('6', sized(4_000)), user('7', '지금')];
    const cut = cutPoint(record, 0);
    expect(record[cut]!.role).toBe('user');
    expect(record.slice(cut).reduce((sum, message) => sum + estimateTokens(message.parts), 0)).toBeGreaterThanOrEqual(KEEP_RECENT_TOKENS);

    const fitted = await fitRecord({ db, chat, route, record, overhead: 5_000 });
    expect(fitted[0]!.id).toBe('compaction');
    expect(fitted.slice(1)).toEqual(record.slice(cut));
    expect(calls(db)).toBe(1);
    const stored = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!;
    expect(stored.compaction).toMatchObject({ upTo: cut, summary: expect.any(String) });
    // The panel marks it: "앞 대화를 요약했습니다" before the first message the summary does not cover.
    const marker = compactionMarker(stored.compaction, record.length);
    expect(marker).toMatchObject({ index: cut, summary: stored.compaction!.summary });
    expect(record[marker!.index]!.role).toBe('user');

    // The next turn reuses the stored summary while the rest fits.
    const next = [...record, reply('8', '답'), user('9', '다음')];
    const again = await fitRecord({ db, chat: stored, route, record: next, overhead: 5_000 });
    expect(again).toEqual(withCompaction(next, stored.compaction));
    expect(calls(db)).toBe(1);
  }, 30_000);

  it('leaves a record with nothing before its newest exchange as it is', async () => {
    const { db, chat, route } = setup(30_000);
    const record = [user('1', sized(40_000))];
    expect(await fitRecord({ db, chat, route, record, overhead: 0 })).toBe(record);
    expect(calls(db)).toBe(0);
  });
});

describe('/compact', () => {
  it('summarizes everything said so far, though it would still fit, and the next turn starts from the summary', async () => {
    const { db, chat, route } = setup(200_000);
    const record = [user('1', '인물 이름은 어떻게 옮길까?'), reply('2', '원어 발음대로 옮기겠습니다.')];
    db.update(s.chatSessions).set({ messages: record, agentSession: { kind: 'grok', model: 'fake', id: 'cli-session', lastTurnAt: 1 } }).where(eq(s.chatSessions.id, chat.id)).run();

    const work = compactNow({ db, sessionId: chat.id, route });
    // A second /compact while the first runs is refused; a turn waits for the first.
    expect(() => compactNow({ db, sessionId: chat.id, route })).toThrow(/이미 압축/);
    let settled = false;
    void compactionSettled(chat.id).then(() => (settled = true));
    const compaction = await work;
    await Promise.resolve();
    expect(settled).toBe(true);

    expect(compaction).toMatchObject({ upTo: 2, summary: expect.any(String) });
    expect(calls(db)).toBe(1);
    const stored = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!;
    expect(stored.compaction).toEqual(compaction);
    // A CLI's own session still holds the whole conversation: it is let go.
    expect(stored.agentSession).toBeNull();
    // The panel marks it after the last message until something new is said.
    expect(compactionMarker(stored.compaction, record.length)).toMatchObject({ index: 2 });

    const next = [...record, user('3', '다음')];
    const fitted = await fitRecord({ db, chat: stored, route, record: next, overhead: 5_000 });
    expect(fitted.map((message) => message.id)).toEqual(['compaction', '3']);
    expect(calls(db)).toBe(1);
  }, 30_000);

  it('refuses when nothing was said since the last one, and summarizes again once something was', async () => {
    const { db, chat, route } = setup(200_000);
    db.update(s.chatSessions).set({ messages: [user('1', '하나'), reply('2', '둘')] }).where(eq(s.chatSessions.id, chat.id)).run();
    await compactNow({ db, sessionId: chat.id, route });
    await expect(compactNow({ db, sessionId: chat.id, route })).rejects.toThrow(/마지막 압축 뒤/);

    db.update(s.chatSessions).set({ messages: [user('1', '하나'), reply('2', '둘'), user('3', '셋'), reply('4', '넷')] }).where(eq(s.chatSessions.id, chat.id)).run();
    const second = await compactNow({ db, sessionId: chat.id, route });
    expect(second.upTo).toBe(4);
    expect(calls(db)).toBe(2);
  }, 30_000);

  it('waits for a reply to finish, and uses the model the conversation talks to', async () => {
    const { db, chat, route } = setup(200_000);
    const deps = { db, secrets: memoryStore() };
    db.update(s.chatSessions).set({ messages: [user('1', '하나'), reply('2', '둘')] }).where(eq(s.chatSessions.id, chat.id)).run();
    await expect(compactChat(deps, chat.id)).rejects.toThrow(/연결과 모델/);

    db.update(s.chatSessions).set({ connectionId: route.connectionId, model: route.model }).where(eq(s.chatSessions.id, chat.id)).run();
    const turn = startTurn(chat.projectId, chat.id);
    await expect(compactChat(deps, chat.id)).rejects.toThrow(/답변이 끝난 뒤/);
    turn.end();
    expect(await compactChat(deps, chat.id)).toMatchObject({ upTo: 2 });
  }, 30_000);

  it('has nothing to do in an empty conversation', async () => {
    const { db, chat, route } = setup(200_000);
    await expect(compactNow({ db, sessionId: chat.id, route })).rejects.toThrow(/압축할 대화가 없습니다/);
    expect(calls(db)).toBe(0);
  });
});
