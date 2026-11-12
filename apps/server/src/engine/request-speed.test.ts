import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { requestSeconds } from './request-speed.ts';

function setup(calls: { tokens: number; seconds: number; kind?: (typeof s.aiCalls.$inferInsert)['kind'] }[]) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'c', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const at = Date.now() - 1e7;
  calls.forEach((call, index) => {
    const startedAt = new Date(at + index * 1e5);
    db.insert(s.aiCalls).values({ projectId: null, kind: call.kind ?? 'run', label: 'x', connectionId: connection.id, model: 'm', status: 'ok', outputTokens: call.tokens, startedAt, finishedAt: new Date(startedAt.getTime() + call.seconds * 1000) } as never).run();
  });
  return { db, connectionId: connection.id };
}

describe('how long a request takes on a model', () => {
  it('is unknown for a model that never answered', () => {
    const { db, connectionId } = setup([]);
    expect(requestSeconds(db, connectionId, 'm', 500)).toBeNull();
  });

  it('is the answer at the speed one 모델 시험 showed', () => {
    const { db, connectionId } = setup([{ tokens: 300, seconds: 6, kind: 'test' }]);
    expect(requestSeconds(db, connectionId, 'm', 1500)).toBeCloseTo(30);
  });

  it('with answers of several lengths, the wait and the speed apart', () => {
    const { db, connectionId } = setup([{ tokens: 100, seconds: 3, kind: 'test' }, { tokens: 300, seconds: 7 }, { tokens: 900, seconds: 19, kind: 'editor' }]);
    expect(requestSeconds(db, connectionId, 'm', 2000)).toBeCloseTo(41);
  });
});
