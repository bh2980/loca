import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { estimateTokens, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { cutPoint, fitRecord, KEEP_RECENT_TOKENS, withCompaction } from './chat-compaction.ts';
import { importProject } from './importer.ts';

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
