import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { liveChoice, snapshotChoice } from './routes.ts';
import { memoryStore } from './secrets.ts';

describe('model choices', () => {
  it('freeze the picked route with the connection\'s output limit for that model', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'a', kind: 'openai', name: 'A', modelLimits: { ma: { maxOutput: 4000, by: 'api' } } }).run();
    const snapshot = snapshotChoice(db, { connectionId: 'a', model: 'ma', effort: 'high' })!;
    expect(snapshot).toMatchObject({ label: 'A · ma · high', maxOutputTokens: 4000, route: { connectionId: 'a', name: 'A', kind: 'openai', model: 'ma', effort: 'high' } });
    expect(snapshot).not.toHaveProperty('routes');
    expect(snapshot).not.toHaveProperty('maxAttempts');
    // A model whose output limit is unknown gets no cap.
    expect(snapshotChoice(db, { connectionId: 'a', model: 'unlisted' })!.maxOutputTokens).toBeUndefined();
    expect(snapshotChoice(db, { connectionId: 'gone', model: 'x' })).toBeUndefined();
  });

  it('refuse a connection that cannot do what the place needs', () => {
    const db = openDatabase(':memory:');
    db.insert(s.connections).values({ id: 'j', kind: 'systemone', name: 'Judge' }).run();
    expect(() => liveChoice(db, { connectionId: 'j', model: 'm' }, memoryStore(), 'chat')).toThrow('채팅에 쓸 수 없습니다');
    expect(() => liveChoice(db, { connectionId: 'x', model: 'm' }, memoryStore(), 'generate')).toThrow('AI 연결이 없습니다');
  });
});
