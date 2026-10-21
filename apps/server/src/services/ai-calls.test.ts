import { describe, expect, it, vi } from 'vitest';
import { events } from '../events.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { closeStaleCalls, logged, startCall } from './ai-calls.ts';

const route = { kind: 'codex' as const, model: 'gpt-test' };

describe('AI call log', () => {
  it('records each request with its usage, and a failure with its reason', async () => {
    const db = openDatabase(':memory:');
    const meta = { projectId: null, kind: 'test' as const, label: '시험' };
    await logged(db, meta, route, async () => ({ usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30 } }));
    await expect(logged(db, meta, route, async () => Promise.reject(Object.assign(new Error('한도 초과'), { usage: { inputTokens: 5 } })))).rejects.toThrow('한도 초과');
    const rows = db.select().from(s.aiCalls).all();
    expect(rows.map(({ status, model, inputTokens, cachedInputTokens, outputTokens, error }) => ({ status, model, inputTokens, cachedInputTokens, outputTokens, error }))).toEqual([
      { status: 'ok', model: 'gpt-test', inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, error: null },
      { status: 'failed', model: 'gpt-test', inputTokens: 5, cachedInputTokens: null, outputTokens: null, error: '한도 초과' },
    ]);
    expect(rows.every((row) => row.finishedAt)).toBe(true);
  });

  it('closes requests a stopped server left running, and finishes a request once', () => {
    const db = openDatabase(':memory:');
    const finish = startCall(db, { projectId: null, kind: 'chat', label: '채팅' }, route);
    closeStaleCalls(db);
    expect(db.select().from(s.aiCalls).get()).toMatchObject({ status: 'failed', error: expect.stringContaining('다시 시작') });
    const second = startCall(db, { projectId: null, kind: 'chat', label: '채팅' }, route);
    second({ error: '오류' });
    second({ usage: { inputTokens: 1 } });
    expect(db.select().from(s.aiCalls).all().at(-1)).toMatchObject({ status: 'failed', error: '오류', inputTokens: null });
    void finish;
  });

  describe('learned model limits', () => {
    const limitsOf = (db: ReturnType<typeof openDatabase>, id: string) => db.select({ limits: s.connections.modelLimits }).from(s.connections).where(eq(s.connections.id, id)).get()?.limits;
    const finishWith = (db: ReturnType<typeof openDatabase>, connectionId: string, limits: { contextWindow?: number; maxOutput?: number }) =>
      startCall(db, { projectId: null, kind: 'test', label: '시험' }, { kind: 'claude', model: 'opus', connectionId })({ usage: { inputTokens: 1, limits } });

    it('are stored under the picked model, replacing an earlier API entry', () => {
      const db = openDatabase(':memory:');
      const { id } = db.insert(s.connections).values({ kind: 'claude', name: 'c', modelLimits: { opus: { contextWindow: 200_000, by: 'api' } } }).returning().get();
      finishWith(db, id, { contextWindow: 1_000_000, maxOutput: 64_000 });
      expect(limitsOf(db, id)).toEqual({ opus: { contextWindow: 1_000_000, maxOutput: 64_000, by: 'api' } });
    });

    it('never replace a person\'s entry', () => {
      const db = openDatabase(':memory:');
      const { id } = db.insert(s.connections).values({ kind: 'claude', name: 'c', modelLimits: { opus: { contextWindow: 50_000, by: 'human' } } }).returning().get();
      finishWith(db, id, { contextWindow: 1_000_000 });
      expect(limitsOf(db, id)).toEqual({ opus: { contextWindow: 50_000, by: 'human' } });
    });

    it('write nothing when the value did not change', () => {
      const db = openDatabase(':memory:');
      const { id } = db.insert(s.connections).values({ kind: 'claude', name: 'c', modelLimits: { opus: { contextWindow: 1_000_000, maxOutput: 64_000, by: 'api' } } }).returning().get();
      const changed = vi.spyOn(events, 'changed');
      finishWith(db, id, { contextWindow: 1_000_000, maxOutput: 64_000 });
      expect(changed).not.toHaveBeenCalledWith(undefined, 'connections');
      finishWith(db, id, { contextWindow: 900_000 });
      expect(changed).toHaveBeenCalledWith(undefined, 'connections');
      changed.mockRestore();
    });
  });
});
