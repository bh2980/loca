import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { learnImages } from './ai-calls.ts';
import { acpImages, incomingImageProblem, withoutImages } from './chat-images.ts';
import { chatUsage } from './chat-usage.ts';
import { importProject } from './importer.ts';

function setup(modelLimits: Record<string, { contextWindow?: number; images?: boolean; by: 'api' | 'human' }> = {}) {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hi' }] }));
  const connection = db.insert(s.connections).values({ name: 'C', kind: 'grok', modelLimits }).returning().get();
  const chat = db.insert(s.chatSessions).values({ projectId, title: '대화', connectionId: connection.id, model: 'm' }).returning().get();
  return { db, projectId, connection, chat };
}
const call = (db: ReturnType<typeof setup>['db'], projectId: string, chatId: string, label: string, inputTokens: number, at: number, costUsd?: number) =>
  db.insert(s.aiCalls).values({ projectId, kind: 'chat', refId: chatId, label, connectionKind: 'grok', model: 'm', status: 'ok', inputTokens, outputTokens: 10, costUsd: costUsd ?? null, startedAt: new Date(at) }).run();

describe('chat usage (문맥 meter)', () => {
  it('reports the last answer input against the known window, summary calls left out', () => {
    const { db, projectId, chat } = setup({ m: { contextWindow: 200_000, by: 'api' } });
    call(db, projectId, chat.id, '채팅', 40_000, 1000, 0.1);
    call(db, projectId, chat.id, '채팅 (CLI)', 60_000, 2000, 0.2);
    call(db, projectId, chat.id, '대화 압축', 150_000, 3000);
    const usage = chatUsage(db, chat);
    expect(usage).toMatchObject({ lastInputTokens: 60_000, window: 200_000, calls: 3 });
    expect(usage.costUsd).toBeCloseTo(0.3);
  });

  it('has no window (the meter hides) when the connection does not know it', () => {
    const { db, chat } = setup();
    expect(chatUsage(db, chat)).toMatchObject({ window: null, lastInputTokens: null, costUsd: null, images: 'unknown' });
  });

  it('knows whether the model takes images from the model list or the agent', () => {
    const { db, connection, chat } = setup({ m: { images: false, by: 'api' } });
    expect(chatUsage(db, chat).images).toBe('no');
    learnImages(db, connection.id, 'm', true);
    expect(chatUsage(db, chat).images).toBe('yes');
    // A person's window is kept when the capability is learned.
    const other = setup({ m: { contextWindow: 9_000, by: 'human' } });
    learnImages(other.db, other.connection.id, 'm', false);
    expect(chatUsage(other.db, other.chat)).toMatchObject({ images: 'no', window: 9_000 });
  });
});

describe('message images', () => {
  const png = `data:image/png;base64,${Buffer.from('hello').toString('base64')}`;
  const message: UIMessage = { id: '1', role: 'user', parts: [{ type: 'text', text: '이거 봐' }, { type: 'file', mediaType: 'image/png', url: png }] };

  it('reads images as ACP blocks and refuses bad ones', () => {
    expect(acpImages(message)).toEqual([{ data: Buffer.from('hello').toString('base64'), mimeType: 'image/png' }]);
    expect(incomingImageProblem(message)).toBeNull();
    expect(incomingImageProblem({ ...message, parts: [{ type: 'file', mediaType: 'application/pdf', url: png }] })).toMatch(/형식/);
    expect(incomingImageProblem({ ...message, parts: Array.from({ length: 5 }, () => ({ type: 'file' as const, mediaType: 'image/png', url: png })) })).toMatch(/4장/);
  });

  it('keeps the text and notes the images that are not sent to a model that takes none', () => {
    const [out] = withoutImages([message]);
    expect(out!.parts.some((part) => part.type === 'file')).toBe(false);
    expect(JSON.stringify(out)).toContain('이 모델은 이미지를 받지 않습니다');
    expect(JSON.stringify(out)).toContain('이거 봐');
  });
});
