import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { liveChoice, snapshotChoice } from './routes.ts';
import { memoryStore } from './secrets.ts';

describe('model choices', () => {
  it('follow each connection\'s fallback in turn, stopping at a loop, with the picked connection\'s call settings', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values([
      { id: 'a', kind: 'openai', name: 'A', timeoutSeconds: 60, maxAttempts: 3, maxOutputTokens: 4000, fallback: { connectionId: 'b', model: 'mb', effort: 'high' } },
      { id: 'b', kind: 'codex', name: 'B', timeoutSeconds: 900, fallback: { connectionId: 'a', model: 'ma' } },
    ]).run();
    const snapshot = snapshotChoice(db, { connectionId: 'a', model: 'ma' })!;
    expect(snapshot).toMatchObject({ label: 'A · ma', timeoutSeconds: 60, maxAttempts: 3, maxOutputTokens: 4000 });
    expect(snapshot.routes.map((route) => [route.name, route.model, route.effort])).toEqual([['A', 'ma', null], ['B', 'mb', 'high']]);
    expect(snapshotChoice(db, { connectionId: 'gone', model: 'x' })).toBeUndefined();
  });

  it('refuse a connection that cannot do what the place needs', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'j', kind: 'systemone', name: 'Judge' }).run();
    expect(() => liveChoice(db, { connectionId: 'j', model: 'm' }, memoryStore(), 'chat')).toThrow('채팅에 쓸 수 없습니다');
    expect(() => liveChoice(db, { connectionId: 'x', model: 'm' }, memoryStore(), 'generate')).toThrow('AI 연결이 없습니다');
  });
});
