import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { liveChoice, snapshotChoice } from './routes.ts';
import { memoryStore } from './secrets.ts';

describe('model choices', () => {
  it('follow each connection\'s fallback in turn, stopping at a loop, with the picked connection\'s call settings', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values([
      { id: 'a', kind: 'openai', name: 'A', maxAttempts: 3, modelLimits: { ma: { maxOutput: 4000, by: 'api' } }, fallback: { connectionId: 'b', model: 'mb', effort: 'high' } },
      { id: 'b', kind: 'codex', name: 'B', fallback: { connectionId: 'a', model: 'ma' } },
    ]).run();
    const snapshot = snapshotChoice(db, { connectionId: 'a', model: 'ma' })!;
    expect(snapshot).toMatchObject({ label: 'A · ma', maxAttempts: 3, maxOutputTokens: 4000 });
    // A model whose output limit is unknown gets no cap.
    expect(snapshotChoice(db, { connectionId: 'a', model: 'unlisted' })!.maxOutputTokens).toBeUndefined();
    expect(snapshot.routes.map((route) => [route.name, route.model, route.effort])).toEqual([['A', 'ma', null], ['B', 'mb', 'high']]);
    expect(snapshotChoice(db, { connectionId: 'gone', model: 'x' })).toBeUndefined();
  });

  it('falls back to another model of the same connection once, without looping', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'or', kind: 'openai', name: 'OpenRouter', fallback: { connectionId: 'or', model: 'cheap' } }).run();
    expect(snapshotChoice(db, { connectionId: 'or', model: 'big' })!.routes.map((route) => route.model)).toEqual(['big', 'cheap']);
    expect(snapshotChoice(db, { connectionId: 'or', model: 'cheap' })!.routes.map((route) => route.model)).toEqual(['cheap']);
  });

  it('refuse a connection that cannot do what the place needs', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'j', kind: 'systemone', name: 'Judge' }).run();
    expect(() => liveChoice(db, { connectionId: 'j', model: 'm' }, memoryStore(), 'chat')).toThrow('채팅에 쓸 수 없습니다');
    expect(() => liveChoice(db, { connectionId: 'x', model: 'm' }, memoryStore(), 'generate')).toThrow('AI 연결이 없습니다');
  });
});
