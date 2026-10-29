import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { importFileSchema, translationTemplate, type BatchConfig, type RetryConfig } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { withoutTerms } from './test-workflows.ts';
import { createRun } from './run-create.ts';

/**
 * What a failure does is visible in the workflow: the 재요청 nodes chained on the AI node's 오류 exit
 * are the only thing between a failed request and the failure path. Nothing is retried, switched to
 * another connection or requeued by the runner on its own.
 */

const CUT_OFF = () => new ai.ModelError('cli', 'Your previous response was cut off because it exceeded the output token limit', false);
const RATE_LIMIT = () => new ai.ModelError('rate-limit', 'slow down');
const NETWORK = () => new ai.ModelError('network', 'connection reset');

interface Options {
  /** Edits to the two 재요청 nodes of the translate node (`-resend`, `-wait`). */
  resend?: Partial<RetryConfig>;
  wait?: Partial<RetryConfig>;
  /** false: the 재요청 nodes are taken out, the AI node's 오류 exit leads to nothing. */
  retry?: boolean;
  failures?: number;
}

/** `lines` lines in one scene through the 번역 template's translate/review nodes, its translate node batching as `batch`. */
function setup(lines: number, batch: Partial<BatchConfig>, { resend, wait, retry = true, failures = 50 }: Options = {}) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: lines }, (_, index) => ({ key: `g1-${index}`, group: 'g1', source: `S0 L${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Scene' }], units }), choice);
  const review = db.insert(s.statuses).values({ projectId, name: '사람 확인 필요', color: '#b26f00', kind: 'normal', inReview: true, sort: 10 }).returning().get();
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const template = withoutTerms(translationTemplate({
    model: choice,
    untranslated: statuses.find((status) => status.kind === 'initial')!.id,
    translated: statuses.find((status) => status.kind === 'normal' && status.id !== review.id)!.id,
    needsReview: review.id,
    confirmed: statuses.find((status) => status.kind === 'final')!.id,
  }));
  const nodes = template.nodes
    .filter((node) => retry || (node.type !== 'retry' && !node.id.endsWith('-failed')))
    .map((node) => {
      if (node.type === 'ai' && node.id === 'translate') return { ...node, config: { ...node.config, concurrency: 1, batch: { mode: 'group' as const, size: 60, maxTokens: null, ...batch } } };
      if (node.type === 'retry' && node.id === 'translate-resend') return { ...node, config: { ...node.config, ...resend } };
      if (node.type === 'retry' && node.id === 'translate-wait') return { ...node, config: { ...node.config, ...wait } };
      return node;
    });
  const ids = new Set(nodes.map((node) => node.id));
  const edges = template.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const definition = { ...template, nodes, edges, settings: { ...template.settings, maxConsecutiveFailures: failures } };
  const workflow = db.insert(s.workflows).values({ projectId, name: '번역', description: '', definition }).returning().get();
  const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} }).runId;
  return { db, runId, projectId, reviewStatusId: review.id, choice };
}

/** Answers every request; `fail(n, size)` makes the nth translate request throw what it returns. Records each translate request's lines and the model it went to. */
function model(fail: (n: number, lines: string[]) => Error | null) {
  const requests: { lines: string[]; model: string }[] = [];
  const port: ModelPort = {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (route, request) => {
      const lines = promptEntries(request.prompt) as { id: string; source: string }[];
      if (request.system.includes('Review each')) return { object: { results: lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage: {} } as never;
      requests.push({ lines: lines.map((line) => line.source), model: route.model });
      const error = fail(requests.length, lines.map((line) => line.source));
      if (error) throw error;
      return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
    },
  };
  return { port, requests, sizes: () => requests.map((request) => request.lines.length) };
}

const runOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;
const itemsOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
const stepsOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();

describe('without a 재요청 node', () => {
  it('sends a rate limit out through 오류 with its kind, once: nothing is retried or requeued', async () => {
    const { db, runId } = setup(4, { mode: 'count', size: 4 }, { retry: false });
    const fake = model(() => RATE_LIMIT());
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes()).toEqual([4]);
    const items = itemsOf(db, runId);
    expect(items.every((item) => item.state === 'failed' && item.data.error?.kind === 'rate-limit' && !item.data.retry)).toBe(true);
    expect(stepsOf(db, runId).filter((step) => step.nodeId === 'translate')).toMatchObject([{ ok: false, errorKind: 'rate-limit' }]);
    expect(runOf(db, runId).status).toBe('completed');
  });

  it('does the same with a dropped connection', async () => {
    const { db, runId } = setup(4, { mode: 'count', size: 4 }, { retry: false });
    const fake = model(() => NETWORK());
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes()).toEqual([4]);
    expect(itemsOf(db, runId).every((item) => item.state === 'failed' && item.data.error?.kind === 'network')).toBe(true);
  });

  it('still counts the failures in a row: the run pauses at the third', async () => {
    const { db, runId } = setup(12, { mode: 'count', size: 4 }, { retry: false, failures: 3 });
    const fake = model(() => RATE_LIMIT());
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(runOf(db, runId)).toMatchObject({ status: 'paused', notice: expect.stringContaining('3번 연달아 실패') });
  });
});

describe('a 재요청 node that waits', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('holds the lines until the time has passed, then sends them back unchanged; the run does not finish meanwhile', async () => {
    const { db, runId } = setup(4, { mode: 'count', size: 4 }, { failures: 1 });
    const fake = model((n) => (n === 1 ? RATE_LIMIT() : null));
    const runner = new Runner(db, memoryStore(), fake.port);
    await runner.drain();
    // One request, failed; its lines wait at the AI node (not failed, not done), the run is still running.
    expect(fake.sizes()).toEqual([4]);
    expect(runOf(db, runId).status).toBe('running');
    const waiting = itemsOf(db, runId);
    expect(waiting.every((item) => item.state === 'queued' && item.nodeId === 'translate' && item.notBefore?.getTime() === Date.now() + 60_000)).toBe(true);
    expect(waiting[0]!.data.retry).toMatchObject({ times: { 'translate-wait': 1 }, factor: 1, last: { kind: 'rate-limit', nodeId: 'translate-wait', waitSeconds: 60 } });
    // A rate limit a 재요청 node takes back is not a failure in a row: 연속 실패 1 does not pause the run.
    // (checked below: the run is still 'running' after the failed call)

    // Nothing happens, and nothing polls, until it is due.
    vi.setSystemTime(Date.now() + 59_000);
    await runner.drain();
    expect(fake.sizes()).toEqual([4]);
    expect(runOf(db, runId).status).toBe('running');

    vi.setSystemTime(Date.now() + 2_000);
    await runner.drain();
    expect(fake.sizes()).toEqual([4, 4]);
    expect(runOf(db, runId).status).toBe('completed');
    expect(itemsOf(db, runId).every((item) => item.state === 'done' && item.notBefore === null)).toBe(true);
    expect(stepsOf(db, runId).filter((step) => step.nodeId === 'translate').map((step) => [step.ok, step.errorKind])).toEqual([[false, 'rate-limit'], [true, null]]);
    await runner.stop();
  });

  it('wakes the run by a timer at the first due time (no polling in between)', async () => {
    vi.useRealTimers();
    const { db, runId } = setup(4, { mode: 'count', size: 4 }, { wait: { wait: 1, kinds: ['rate-limit', 'network'] } });
    const fake = model((n) => (n === 1 ? NETWORK() : null));
    const runner = new Runner(db, memoryStore(), fake.port);
    await runner.drain();
    expect(fake.sizes()).toEqual([4]);
    const ticks = vi.spyOn(runner, 'tick');
    // Not started (no interval), so only the run's own timer can bring it back.
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(ticks).toHaveBeenCalledTimes(1);
    await runner.drain();
    expect(fake.sizes()).toEqual([4, 4]);
    expect(runOf(db, runId).status).toBe('completed');
    await runner.stop();
  });

  it('keeps holding while the run is paused, goes on after resume, and a cancel drops the wait', async () => {
    const { db, runId } = setup(4, { mode: 'count', size: 4 });
    const fake = model((n) => (n === 1 ? RATE_LIMIT() : null));
    const runner = new Runner(db, memoryStore(), fake.port);
    await runner.drain();
    expect(fake.sizes()).toEqual([4]);

    runner.pause(runId);
    vi.setSystemTime(Date.now() + 120_000);
    await runner.drain();
    expect(fake.sizes()).toEqual([4]);
    expect(runOf(db, runId).status).toBe('paused');

    runner.resume(runId);
    await runner.drain();
    expect(fake.sizes()).toEqual([4, 4]);
    expect(runOf(db, runId).status).toBe('completed');
    await runner.stop();

    const again = setup(4, { mode: 'count', size: 4 });
    const second = model((n) => (n === 1 ? RATE_LIMIT() : null));
    const other = new Runner(again.db, memoryStore(), second.port);
    await other.drain();
    other.cancel(again.runId);
    vi.setSystemTime(Date.now() + 120_000);
    await other.drain();
    expect(second.sizes()).toEqual([4]);
    expect(runOf(again.db, again.runId).status).toBe('cancelled');
    expect(itemsOf(again.db, again.runId).every((item) => item.state === 'cancelled')).toBe(true);
    await other.stop();
  });

  it('is still picked up after the run is continued while lines wait', async () => {
    const { db, runId } = setup(4, { mode: 'count', size: 4 });
    const fake = model((n) => (n === 1 ? RATE_LIMIT() : null));
    const runner = new Runner(db, memoryStore(), fake.port);
    await runner.drain();
    runner.pause(runId);
    const run = runOf(db, runId);
    const result = runner.continue(runId, { definition: run.definition, models: run.models, changes: [], retryFailed: false });
    expect(result.ok).toBe(true);
    vi.setSystemTime(Date.now() + 61_000);
    await runner.drain();
    expect(runOf(db, runId).status).toBe('completed');
    await runner.stop();
  });
});

describe('chained 재요청 nodes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('offers a failure to the first, then the next: cut-off is halved, a rate limit then waits and goes back at that size', async () => {
    const { db, runId } = setup(8, { mode: 'count', size: 8 });
    // 8 lines cut off → 2 × 4 (half); the first of those is rate-limited → it waits, then goes back as 4.
    const fake = model((n) => (n === 1 ? CUT_OFF() : n === 2 ? RATE_LIMIT() : null));
    const runner = new Runner(db, memoryStore(), fake.port);
    await runner.drain();
    expect(fake.sizes()).toEqual([8, 4, 4]);
    expect(runOf(db, runId).status).toBe('running');
    const items = itemsOf(db, runId);
    const waiting = items.filter((item) => item.state === 'queued');
    expect(waiting).toHaveLength(4);
    expect(waiting.every((item) => item.data.retry?.times['translate-resend'] === 1 && item.data.retry.times['translate-wait'] === 1 && item.data.retry.last?.nodeId === 'translate-wait')).toBe(true);
    // The path shows the order: AI → first 재요청 (cut-off, sent back) → AI → first 재요청 (not its kind: 오류) → second → AI.
    const path = waiting[0]!.data.path.map((step) => `${step.nodeId}:${step.port}`);
    expect(path.slice(path.indexOf('translate-resend:retry'))).toEqual(['translate-resend:retry', 'translate:error', 'translate-resend:error', 'translate-wait:retry']);

    vi.setSystemTime(Date.now() + 61_000);
    await runner.drain();
    // Half size stays (the second node keeps the size), so the 4 go back as one request of 4.
    expect(fake.sizes()).toEqual([8, 4, 4, 4]);
    expect(runOf(db, runId).status).toBe('completed');
    expect(itemsOf(db, runId).every((item) => item.state === 'done')).toBe(true);
    await runner.stop();
  });

  it('counts the times of each node on its own: two halvings, one more try at the second, then the failure path', async () => {
    const { db, runId, projectId, reviewStatusId } = setup(8, { mode: 'count', size: 8 }, { wait: { kinds: ['cut-off'], scale: 1, wait: 0, maxTimes: 1 } });
    const fake = model(() => CUT_OFF());
    await new Runner(db, memoryStore(), fake.port).drain();
    // 8, 2 × 4, 4 × 2, then the second node sends them back once more as they are: 4 × 2, then nothing.
    expect(fake.sizes().sort((a, b) => b - a)).toEqual([8, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2]);
    for (const item of itemsOf(db, runId)) {
      expect(item.state).toBe('done');
      expect(item.data.retry).toMatchObject({ times: { 'translate-resend': 2, 'translate-wait': 1 }, factor: 0.25 });
    }
    expect(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().every((unit) => unit.statusId === reviewStatusId)).toBe(true);
  });

  it('stops at maxTimes of the node a failure kind belongs to', async () => {
    const { db, runId } = setup(4, { mode: 'count', size: 4 }, { wait: { wait: 0, maxTimes: 3 } });
    const fake = model(() => RATE_LIMIT());
    await new Runner(db, memoryStore(), fake.port).drain();
    // The first request and three sent back, then 검토 필요로.
    expect(fake.sizes()).toEqual([4, 4, 4, 4]);
    expect(itemsOf(db, runId).every((item) => item.state === 'done' && item.data.retry?.times['translate-wait'] === 3 && item.data.retry.times['translate-resend'] === undefined)).toBe(true);
  });

  it('does not count a request whose lines a node of the chain sends back as a failure in a row', async () => {
    const { db, runId } = setup(40, { mode: 'count', size: 4 }, { wait: { wait: 0 }, failures: 2 });
    // Three first-time requests are rate-limited, then everything works.
    let first = 0;
    const fake = model((_n, lines) => (lines.length === 4 && ++first <= 3 ? RATE_LIMIT() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(runOf(db, runId).status).toBe('completed');
  });
});

describe('a 재요청 node with another model', () => {
  it('sends its lines back on that model, apart from the lines the AI node\'s own model goes on with, and records the model used', async () => {
    const { db, runId, choice } = setup(8, { mode: 'count', size: 4 }, {});
    // Edit the run's own workflow: the second 재요청 node sends rate-limited lines to another model of the connection.
    const run = runOf(db, runId);
    const definition = { ...run.definition, nodes: run.definition.nodes.map((node) => (node.id === 'translate-wait' && node.type === 'retry' ? { ...node, config: { ...node.config, wait: 0, model: { connectionId: choice.connectionId, model: 'm2', effort: 'low' } } } : node)) };
    db.update(s.runs).set({ definition, models: snapshotWorkflowModels(db, definition) }).where(eq(s.runs.id, runId)).run();
    expect(Object.values(runOf(db, runId).models).map((snapshot) => snapshot.route.model).sort()).toEqual(['m', 'm2']);

    // L0-L3 are rate-limited (→ m2, as they were), L4-L7 are cut off (→ halved, on m).
    const fake = model((n, lines) => (n === 1 ? RATE_LIMIT() : lines.length === 4 && lines[0] === 'S0 L4' ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    // The two first-time requests (4 lines each, on m) aside, what is left was sent back.
    const again = fake.requests.filter((request) => request.model === 'm2' || request.lines.length < 4);
    const other = again.filter((request) => request.model === 'm2');
    const own = again.filter((request) => request.model === 'm');
    expect(other.map((request) => request.lines)).toEqual([['S0 L0', 'S0 L1', 'S0 L2', 'S0 L3']]);
    expect(own.map((request) => request.lines.length)).toEqual([2, 2]);
    expect(own.flatMap((request) => request.lines).sort()).toEqual(['S0 L4', 'S0 L5', 'S0 L6', 'S0 L7']);
    expect(runOf(db, runId).status).toBe('completed');
    // The steps say which model answered, and the lines keep what sent them there.
    const steps = stepsOf(db, runId).filter((step) => step.nodeId === 'translate');
    expect(steps.map((step) => [step.ok, step.model]).sort()).toEqual([[false, 'm'], [false, 'm'], [true, 'm'], [true, 'm'], [true, 'm2']].sort());
    expect(steps.find((step) => step.model === 'm2')?.connectionId).toBe(choice.connectionId);
    const item = itemsOf(db, runId).find((candidate) => candidate.data.retry?.times['translate-wait'])!;
    expect(item.data.retry?.model).toEqual({ nodeId: 'translate', key: `${choice.connectionId}|m2|low` });
  });

  it('forgets the other model when a later 재요청 node has none picked', async () => {
    const { db, runId, choice } = setup(4, { mode: 'count', size: 4 }, {
      resend: { kinds: ['rate-limit'], scale: 1, maxTimes: 1, wait: 0, model: { connectionId: '', model: '' } },
      wait: { kinds: ['rate-limit', 'cut-off'], wait: 0 },
    });
    const run = runOf(db, runId);
    const definition = { ...run.definition, nodes: run.definition.nodes.map((node) => (node.id === 'translate-resend' && node.type === 'retry' ? { ...node, config: { ...node.config, model: { connectionId: choice.connectionId, model: 'm2' } } } : node)) };
    db.update(s.runs).set({ definition, models: snapshotWorkflowModels(db, definition) }).where(eq(s.runs.id, runId)).run();
    // m → rate-limit → resend (m2) → cut off → wait node (own model again) → ok.
    const fake = model((n) => (n === 1 ? RATE_LIMIT() : n === 2 ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.requests.map((request) => request.model)).toEqual(['m', 'm2', 'm']);
  });
});
