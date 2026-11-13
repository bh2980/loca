import { describe, expect, it } from 'vitest';
import type { Run } from './runs';
import { runNoticesOf } from './run-notices';

const run = (id: string, over: Partial<Run> = {}): Run =>
  ({
    id,
    workflowId: 'w1',
    workflowName: `워크플로 ${id}`,
    workflowVersion: 1,
    subject: 'lines',
    status: 'completed',
    notice: null,
    total: 10,
    createdAt: new Date(1_000).toISOString(),
    finishedAt: new Date(2_000).toISOString(),
    sessionId: null,
    states: { done: 10 },
    calls: null,
    ...over,
  }) as Run;

describe('runNoticesOf', () => {
  const empty = { since: 1_500, read: [], dismissed: [] };

  it('completed after since becomes completed notice, and completed with failed > 0 becomes failed', () => {
    const ok = run('ok', { finishedAt: new Date(2_000).toISOString(), states: { done: 8, skipped: 2 } });
    const bad = run('bad', { finishedAt: new Date(3_000).toISOString(), states: { done: 7, failed: 3 } });
    expect(runNoticesOf([ok, bad], empty)).toEqual([
      {
        id: 'bad',
        workflowName: '워크플로 bad',
        subject: 'lines',
        kind: 'failed',
        total: 10,
        done: 7,
        failed: 3,
        notice: null,
        endedAt: 3_000,
        read: false,
      },
      {
        id: 'ok',
        workflowName: '워크플로 ok',
        subject: 'lines',
        kind: 'completed',
        total: 10,
        done: 10,
        failed: 0,
        notice: null,
        endedAt: 2_000,
        read: false,
      },
    ]);
  });

  it('completed before since is absent, while paused before since stays present', () => {
    const oldDone = run('old-done', { finishedAt: new Date(1_500).toISOString() });
    const oldPaused = run('old-paused', {
      status: 'paused',
      notice: '인증 오류',
      createdAt: new Date(500).toISOString(),
      finishedAt: null,
      states: { done: 4, queued: 6 },
    });
    const notices = runNoticesOf([oldDone, oldPaused], empty);
    expect(notices.map((n) => [n.id, n.kind, n.endedAt])).toEqual([['old-paused', 'paused', 500]]);
  });

  it('cancelled after since becomes cancelled, running and preparing are absent', () => {
    const cancelled = run('c1', { status: 'cancelled', finishedAt: new Date(2_500).toISOString(), states: { done: 3, cancelled: 7 } });
    const running = run('r1', { status: 'running', finishedAt: null, createdAt: new Date(3_000).toISOString() });
    const preparing = run('p1', { status: 'preparing', finishedAt: null, createdAt: new Date(4_000).toISOString() });
    expect(runNoticesOf([cancelled, running, preparing], empty)).toMatchObject([
      { id: 'c1', kind: 'cancelled', done: 3, failed: 0, endedAt: 2_500 },
    ]);
  });

  it('respects dismissed, read flag, and orders newest endedAt first', () => {
    const r1 = run('r1', { finishedAt: new Date(2_000).toISOString() });
    const r2 = run('r2', { finishedAt: new Date(4_000).toISOString() });
    const r3 = run('r3', { finishedAt: new Date(3_000).toISOString() });
    const notices = runNoticesOf([r1, r2, r3], { since: 1_500, read: ['r3'], dismissed: ['r2'] });
    expect(notices.map((n) => ({ id: n.id, read: n.read, endedAt: n.endedAt }))).toEqual([
      { id: 'r3', read: true, endedAt: 3_000 },
      { id: 'r1', read: false, endedAt: 2_000 },
    ]);
  });
});
