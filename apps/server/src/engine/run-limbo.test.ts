import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@loca/ai';
import { importFileSchema, workflowDefinitionSchema } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../domain/model-target.ts';
import { continueRun } from '../services/run-continue.ts';
import { memoryStore, storeFailure, type SecretStore } from '../domain/secrets.ts';
import { promptEntries } from './prompts.ts';
import * as request from './request.ts';
import { createRun, createRunInSteps, UNPREPARED } from './run-create.ts';
import { Runner, type ModelPort } from './runner.ts';

// The real builder unless a test makes it throw.
vi.mock('./request.ts', { spy: true });
afterEach(() => vi.mocked(request.buildRequest).mockRestore());

const at = { x: 0, y: 0 };

/** `lines` lines in one scene and entry → AI 번역 (4 lines per request, one request at a time, no exits: a failed line ends failed). */
function setup(lines: number, config: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: lines }, (_, index) => ({ key: `l${index}`, group: 'g', source: `Line ${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units }), choice);
  const definition = workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: {} },
      { id: 'translate', type: 'ai', position: at, config: { model: choice, instructions: 'Translate.', output: 'text', concurrency: 1, batch: { mode: 'count', size: 4 }, ...config } },
    ],
    edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'translate' }],
    settings: { retries: [], ...settings },
  });
  const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition }).returning().get();
  const input = { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} };
  return { db, projectId, workflow, input };
}

/** Translates every line; `fail(n)` makes the nth request throw what it returns. */
function model(fail: (n: number) => Error | null = () => null) {
  let calls = 0;
  const port: ModelPort = {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (_target, sent) => {
      const error = fail(++calls);
      if (error) throw error;
      return { object: { results: (promptEntries(sent.prompt) as { id: string }[]).map((line) => ({ id: line.id, text: `[ko] ${line.id}` })) }, usage: {} } as never;
    },
  };
  return { port, calls: () => calls };
}

type Db = ReturnType<typeof setup>['db'];
const runOf = (db: Db, runId: string) => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;
const itemsOf = (db: Db, runId: string) => db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
const stepsOf = (db: Db, runId: string) => db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();

describe('a dispatched request always ends in a recorded outcome', () => {
  it('a key store that cannot be read: the request is recorded as failed and the run pauses, saying why', async () => {
    const { db, input } = setup(8);
    const { runId } = createRun(db, input);
    const locked: SecretStore = { ...memoryStore(), get: () => { throw storeFailure(new Error('User interaction is not allowed.'), '읽기', 'darwin'); } };
    const fake = model();
    await new Runner(db, locked, fake.port).drain();

    expect(fake.calls()).toBe(0);
    const run = runOf(db, runId);
    expect(run.status).toBe('paused');
    expect(run.notice).toContain('인증 오류');
    expect(run.notice).toContain('키체인');
    // Nothing is left running: the first request's lines failed through the error exit, the others still wait.
    const items = itemsOf(db, runId);
    expect(items.filter((item) => item.state === 'running')).toEqual([]);
    expect(items.filter((item) => item.state === 'failed')).toHaveLength(4);
    expect(items.filter((item) => item.state === 'queued')).toHaveLength(4);
    expect(stepsOf(db, runId)).toMatchObject([{ ok: false, errorKind: 'other', error: expect.stringContaining('API 키 읽기') }]);

    // With the store readable again the run goes on and its failed lines can be sent again.
    expect(continueRun(db, runId, { retryFailed: true })).toMatchObject({ ok: true, retried: 4 });
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(runOf(db, runId).status).toBe('completed');
    expect(itemsOf(db, runId).every((item) => item.state === 'done')).toBe(true);
  });

  it('a request that cannot be built: its lines fail with the reason and the others go on', async () => {
    const { db, input } = setup(12);
    const { runId } = createRun(db, input);
    const actual = await vi.importActual<typeof request>('./request.ts');
    let built = 0;
    vi.mocked(request.buildRequest).mockImplementation((...args) => {
      if (++built === 2) throw new Error('context could not be read');
      return actual.buildRequest(...args);
    });
    const fake = model();
    await new Runner(db, memoryStore(), fake.port).drain();

    expect(fake.calls()).toBe(2);
    expect(runOf(db, runId).status).toBe('completed');
    const items = itemsOf(db, runId);
    expect(items.filter((item) => item.state === 'done')).toHaveLength(8);
    const failed = items.filter((item) => item.state === 'failed');
    expect(failed).toHaveLength(4);
    expect(failed.every((item) => item.error === 'context could not be read' && item.data.lastError?.kind === 'other')).toBe(true);
    expect(stepsOf(db, runId).filter((step) => !step.ok)).toMatchObject([{ error: 'context could not be read', errorKind: 'other', prompt: null }]);
  });

  it('counts requests that cannot be built toward 연속 실패 like any failed request', async () => {
    const { db, input } = setup(40, {}, { maxConsecutiveFailures: 3 });
    const { runId } = createRun(db, input);
    vi.mocked(request.buildRequest).mockImplementation(() => {
      throw new Error('context could not be read');
    });
    await new Runner(db, memoryStore(), model().port).drain();
    const run = runOf(db, runId);
    expect(run.status).toBe('paused');
    expect(run.notice).toContain('3번 연달아');
    expect(itemsOf(db, runId).filter((item) => item.state === 'running')).toEqual([]);
  });

  it('lines left running with no request out for them wait again instead of holding the run open', async () => {
    const { db, input } = setup(4);
    const { runId } = createRun(db, input);
    const runner = new Runner(db, memoryStore(), model().port);
    await runner.tick();
    await runner.tick();
    // As if a request had ended without a record.
    db.update(s.runItems).set({ state: 'running' }).where(eq(s.runItems.runId, runId)).run();
    db.update(s.runs).set({ status: 'running', finishedAt: null }).where(eq(s.runs.id, runId)).run();
    await runner.drain();
    expect(runOf(db, runId).status).toBe('completed');
    expect(itemsOf(db, runId).every((item) => item.state === 'done')).toBe(true);
  });
});

describe('a failure the retry rules took back', () => {
  const CUT_OFF = () => new ai.ModelError('cut-off', '응답이 길이 제한에 걸려 잘렸습니다.', false);
  const rules = { retries: [{ kinds: ['cut-off'], scale: 0.5, wait: 0, maxTimes: 3 }], maxConsecutiveFailures: 3 };

  it('is marked on its step, so after a restart it still does not count toward 연속 실패', async () => {
    const { db, input } = setup(40, {}, rules);
    const { runId } = createRun(db, input);
    // Two requests are cut off (their lines go back, halved), then the server stops.
    const first = model((n) => (n <= 2 ? CUT_OFF() : null));
    const before = new Runner(db, memoryStore(), {
      ...first.port,
      generate: async (target, sent) => {
        if (first.calls() === 1) db.update(s.runs).set({ status: 'paused' }).where(eq(s.runs.id, runId)).run();
        return first.port.generate(target, sent);
      },
    });
    await before.drain();
    expect(stepsOf(db, runId).map((step) => [step.ok, step.retried])).toEqual([[false, true], [false, true]]);
    expect(runOf(db, runId).status).toBe('paused');

    // A new runner (nothing in memory) meets one more cut-off: three failed requests in a row on record, none of which counts.
    expect(continueRun(db, runId)).toMatchObject({ ok: true, resumed: true });
    const second = model((n) => (n === 1 ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), second.port).drain();
    const run = runOf(db, runId);
    expect(run.notice).toBeNull();
    expect(run.status).toBe('completed');
    expect(stepsOf(db, runId).filter((step) => !step.ok).map((step) => step.retried)).toEqual([true, true, true]);
    expect(itemsOf(db, runId).every((item) => item.state === 'done')).toBe(true);
  });

  it('counts once no rule takes the lines back', async () => {
    const { db, input } = setup(40, {}, { ...rules, retries: [] });
    const { runId } = createRun(db, input);
    await new Runner(db, memoryStore(), model(() => CUT_OFF()).port).drain();
    expect(runOf(db, runId).status).toBe('paused');
    expect(stepsOf(db, runId).map((step) => step.retried)).toEqual([false, false, false]);
  });
});

describe('a run that is still being stored', () => {
  it('is "preparing": it cannot be continued, and starts by itself once all its lines are in', async () => {
    const { db, input } = setup(5_000);
    const pending = createRunInSteps(db, input);
    const early = db.select().from(s.runs).all()[0]!;
    expect(early).toMatchObject({ status: 'preparing', notice: null });
    expect(continueRun(db, early.id)).toMatchObject({ ok: false, error: expect.stringContaining('넣는 중') });
    // A runner does not touch it either.
    await new Runner(db, memoryStore(), model().port).tick();
    expect(runOf(db, early.id).status).toBe('preparing');
    const { runId, total } = await pending;
    expect(total).toBe(5_000);
    expect(itemsOf(db, runId)).toHaveLength(5_000);
    expect(runOf(db, runId)).toMatchObject({ status: 'running', notice: null });
  });

  it('is closed at startup when the server stopped before its lines were all in, saying so', async () => {
    const { db, input } = setup(5_000);
    const pending = createRunInSteps(db, input);
    const early = db.select().from(s.runs).all()[0]!;
    // The server "restarts" while the run is half stored.
    const runner = new Runner(db, memoryStore(), model().port);
    runner.start(60_000);
    await runner.stop();
    expect(runOf(db, early.id)).toMatchObject({ status: 'cancelled', notice: UNPREPARED });
    expect(runOf(db, early.id).finishedAt).not.toBeNull();
    // What was storing it stops: no line of a closed run is left waiting.
    await pending;
    expect(runOf(db, early.id).status).toBe('cancelled');
    expect(itemsOf(db, early.id).filter((item) => item.state === 'queued' || item.state === 'running')).toEqual([]);
    // It no longer blocks a continue with "still being stored", nor counts as going.
    expect(continueRun(db, early.id)).toMatchObject({ ok: false, error: expect.stringContaining('취소') });
  });

  it('stops storing lines when it is cancelled meanwhile', async () => {
    const { db, input } = setup(5_000);
    const pending = createRunInSteps(db, input);
    const early = db.select().from(s.runs).all()[0]!;
    new Runner(db, memoryStore(), model().port).cancel(early.id);
    await pending;
    expect(runOf(db, early.id).status).toBe('cancelled');
    expect(itemsOf(db, early.id).filter((item) => item.state === 'queued')).toEqual([]);
  });
});
