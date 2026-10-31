import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { importFileSchema, translationTemplate, type BatchConfig } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { withoutTerms } from './test-workflows.ts';
import { createRun } from './run-create.ts';
import { Hono } from 'hono';
import type { Env } from '../context.ts';
import { workflowRoutes } from '../routes/workflows.ts';
import { issueTagIds } from '../services/issue-tags.ts';

const CUT_OFF = () => new ai.ModelError('cli', 'Your previous response was cut off because it exceeded the output token limit', false);

/**
 * One scene of `lines` lines run through the translate/review template (whose AI nodes are followed by
 * a 재요청 node), its translate node batching as `batch`. `resend: false` takes the 재요청 nodes out.
 */
function setup(lines: number, batch: Partial<BatchConfig>, { resend = true, failures = 50 }: { resend?: boolean; failures?: number } = {}) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: lines }, (_, index) => ({ key: `g1-${index}`, group: 'g1', source: `S0 L${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Scene' }], units }), choice);
  const review = db.insert(s.statuses).values({ projectId, name: '사람 확인 필요', color: '#b26f00', kind: 'normal', inReview: true, sort: 10 }).returning().get();
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const template = withoutTerms(translationTemplate({
    model: choice,
    issueTags: issueTagIds(db, projectId),
    untranslated: statuses.find((status) => status.kind === 'initial')!.id,
    translated: statuses.find((status) => status.kind === 'normal' && status.id !== review.id)!.id,
    needsReview: review.id,
    confirmed: statuses.find((status) => status.kind === 'final')!.id,
  }));
  const nodes = template.nodes
    .filter((node) => resend || (node.type !== 'retry' && !node.id.endsWith('-failed')))
    .map((node) => (node.type === 'ai' && node.id === 'translate' ? { ...node, config: { ...node.config, concurrency: 1, batch: { mode: 'group' as const, size: 60, maxTokens: null, ...batch } } } : node));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = template.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const definition = { ...template, nodes, edges, settings: { ...template.settings, maxConsecutiveFailures: failures } };
  const workflow = db.insert(s.workflows).values({ projectId, name: '번역', description: '', definition }).returning().get();
  const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} }).runId;
  return { db, runId, projectId, reviewStatusId: review.id };
}

/** Answers every request; `fail(n, sources)` makes the nth translate request throw what it returns. Records each translate request's lines. */
function model(fail: (n: number, size: number) => Error | null) {
  const requests: string[][] = [];
  const port: ModelPort = {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      const lines = promptEntries(request.prompt) as { id: string; source: string }[];
      if (request.system.includes('Review each')) return { object: { results: lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage: {} } as never;
      requests.push(lines.map((line) => line.source));
      const error = fail(requests.length, lines.length);
      if (error) throw error;
      return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
    },
  };
  return { port, requests, sizes: () => requests.map((lines) => lines.length) };
}

const runOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;
const itemsOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();

describe('재요청 node', () => {
  it('sends cut-off lines back at 0.5, then 0.25 of the request size, then out through 오류 to 검토 필요 with the original failure kept on the item', async () => {
    const { db, runId, projectId, reviewStatusId } = setup(8, { mode: 'count', size: 8 });
    const fake = model(() => CUT_OFF());
    await new Runner(db, memoryStore(), fake.port).drain();
    // 8 lines, then 2 × 4 (× 0.5), then 4 × 2 (× 0.25), then nothing: two retries used up.
    expect(fake.sizes().sort((a, b) => b - a)).toEqual([8, 4, 4, 2, 2, 2, 2]);
    const items = itemsOf(db, runId);
    expect(items).toHaveLength(8);
    for (const item of items) {
      // The 재요청's 오류 exit is wired to 검토 필요로: the line is handed to a person, not failed.
      expect(item.state).toBe('done');
      expect(item.data.retry).toMatchObject({ times: { 'translate-resend': 2 }, factor: 0.25, last: { kind: 'cut-off' } });
    }
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    expect(units.every((unit) => unit.statusId === reviewStatusId)).toBe(true);
  });

  it('leaves a failure it was not told to send back through 오류 at once, untouched and at the same size', async () => {
    const { db, runId, projectId, reviewStatusId } = setup(8, { mode: 'count', size: 8 });
    const fake = model(() => new Error('boom'));
    await new Runner(db, memoryStore(), fake.port).drain();
    // Not resent at all: 'other' is not one of the 재요청's kinds, so the line goes straight to 검토 필요로.
    expect(fake.sizes()).toEqual([8]);
    for (const item of itemsOf(db, runId)) {
      expect(item.state).toBe('done');
      expect(item.data.retry).toBeUndefined();
    }
    expect(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().every((unit) => unit.statusId === reviewStatusId)).toBe(true);
  });

  it('runs a cut-off request again in smaller requests, which succeed', async () => {
    const { db, runId } = setup(8, { mode: 'count', size: 8 });
    const fake = model((n) => (n === 1 ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes()).toEqual([8, 4, 4]);
    expect(runOf(db, runId).status).toBe('completed');
    const items = itemsOf(db, runId);
    expect(items.every((item) => item.state === 'done')).toBe(true);
    // The factor stays on the lines, but they are done: nothing is held back by it.
    expect(items.every((item) => item.data.retry?.factor === 0.5 && !item.data.error)).toBe(true);
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    expect(steps.filter((step) => step.nodeId === 'translate').map((step) => step.ok)).toEqual([false, true, true]);
  });

  it('batches lines sent back apart from the first-time ones, at the node\'s budget times the factor (group mode)', async () => {
    // maxTokens 1000: 45 lines of 22 tokens a request; 90 lines make two requests, the first is cut off.
    const { db, runId } = setup(90, { maxTokens: 1000 });
    const fake = model((n) => (n === 1 ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    const [cutOff, ...rest] = fake.requests;
    expect(cutOff).toHaveLength(45);
    const sent = new Set(cutOff);
    const again = rest.filter((lines) => lines.some((line) => sent.has(line)));
    const first = rest.filter((lines) => !lines.some((line) => sent.has(line)));
    // Never mixed; the first-time lines keep the full budget, the sent back ones get half of it (22 lines of 22 tokens a request).
    expect(rest.every((lines) => lines.every((line) => sent.has(line)) || lines.every((line) => !sent.has(line)))).toBe(true);
    expect(first.map((lines) => lines.length)).toEqual([45]);
    expect(again.map((lines) => lines.length).sort((a, b) => b - a)).toEqual([22, 22, 1]);
    expect(runOf(db, runId).status).toBe('completed');
  });

  it('batches lines sent back by the node\'s line count times the factor (count mode)', async () => {
    const { db } = setup(40, { mode: 'count', size: 20 });
    const fake = model((n) => (n === 1 ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    const [cutOff, ...rest] = fake.requests;
    const sent = new Set(cutOff);
    expect(rest.filter((lines) => lines.some((line) => sent.has(line))).map((lines) => lines.length)).toEqual([10, 10]);
    expect(rest.filter((lines) => !lines.some((line) => sent.has(line))).map((lines) => lines.length)).toEqual([20]);
  });
});

describe('cut-offs and 연속 실패', () => {
  it('does not count cut-offs a 재요청 node takes back: four in a row do not pause, and the smaller requests succeed', async () => {
    const { db, runId } = setup(40, { mode: 'count', size: 4 }, { failures: 3 });
    // The first four first-time requests (4 lines) are cut off; the smaller ones sent back are answered.
    let firstTime = 0;
    const fake = model((_n, size) => (size === 4 && ++firstTime <= 4 ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(firstTime).toBeGreaterThan(4);
    expect(fake.sizes().filter((size) => size < 4).length).toBeGreaterThanOrEqual(8);
    expect(runOf(db, runId).status).toBe('completed');
    expect(itemsOf(db, runId).every((item) => item.state === 'done')).toBe(true);
  });

  it('counts a failure once the retries are used up', async () => {
    const { db, runId } = setup(40, { mode: 'count', size: 4 }, { failures: 3 });
    const fake = model(() => CUT_OFF());
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(runOf(db, runId).status).toBe('paused');
  });

  it('pauses at the third cut-off request in a row when no 재요청 node follows', async () => {
    const { db, runId } = setup(40, { mode: 'count', size: 4 }, { resend: false, failures: 3 });
    const fake = model(() => CUT_OFF());
    await new Runner(db, memoryStore(), fake.port).drain();
    const run = runOf(db, runId);
    expect(run.status).toBe('paused');
    expect(run.notice).toContain('호출이 3번 연달아 실패해서 멈췄습니다.');
    expect(fake.sizes()).toEqual([4, 4, 4]);
    expect(itemsOf(db, runId).filter((item) => item.nodeId === 'translate' && item.state === 'queued').length).toBeGreaterThan(0);
  });

  it('counts only requests in a row: an answered one starts the count again', async () => {
    const { db, runId } = setup(60, { mode: 'count', size: 8 }, { resend: false, failures: 3 });
    const fake = model((n) => (n % 3 === 0 ? null : CUT_OFF()));
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes().length).toBeGreaterThan(6);
    expect(runOf(db, runId).status).toBe('completed');
  });

  it('does not re-split anything on its own: a cut-off request is only recorded', async () => {
    const { db, runId } = setup(40, { mode: 'count', size: 8 }, { resend: false, failures: 50 });
    const fake = model((n) => (n === 1 ? CUT_OFF() : null));
    await new Runner(db, memoryStore(), fake.port).drain();
    expect(fake.sizes()).toEqual([8, 8, 8, 8, 8]);
    expect(runOf(db, runId).notice).toBeNull();
    const node = runOf(db, runId).definition.nodes.find((candidate) => candidate.id === 'translate') as { config: { batch: BatchConfig } };
    expect(node.config.batch.size).toBe(8);
  });
});

describe('lines being resent, as the run page reads them', () => {
  it('exposes why a line waits, filters by it, and counts the failure kinds per 재요청 node', async () => {
    const { db, runId } = setup(8, { mode: 'count', size: 8 });
    // The first request is cut off and its 8 lines are sent back once, after a wait of a minute: they wait at the AI node.
    const run = runOf(db, runId);
    db.update(s.runs).set({ definition: { ...run.definition, nodes: run.definition.nodes.map((node) => (node.id === 'translate-resend' && node.type === 'retry' ? { ...node, config: { ...node.config, wait: 60 } } : node)) } }).where(eq(s.runs.id, runId)).run();
    const runner = new Runner(db, memoryStore(), model((n) => (n === 1 ? CUT_OFF() : null)).port);
    await runner.drain();
    const app = new Hono<Env>()
      .use(async (context, next) => {
        context.set('deps', { db, runner } as never);
        await next();
      })
      .route('/', workflowRoutes);

    const all = (await (await app.request(`/runs/${runId}/items`)).json()) as { total: number; rows: { state: string; retry: { times: number; max: number; kind: string; message: string; nodeId: string; waitsUntil: number | null } | null }[] };
    expect(all.total).toBe(8);
    expect(all.rows.every((row) => row.state === 'queued' && row.retry?.times === 1 && row.retry.max === 2 && row.retry.kind === 'cut-off' && row.retry.message.length > 0 && row.retry.nodeId === 'translate-resend' && row.retry.waitsUntil! > Date.now())).toBe(true);
    const retrying = (await (await app.request(`/runs/${runId}/items?state=retrying`)).json()) as { total: number };
    expect(retrying.total).toBe(8);
    expect(((await (await app.request(`/runs/${runId}/items?state=failed`)).json()) as { total: number }).total).toBe(0);

    const detail = (await (await app.request(`/runs/${runId}`)).json()) as { retrying: Record<string, { count: number; kinds: Record<string, number> }> };
    expect(detail.retrying).toEqual({ 'translate-resend': { count: 8, kinds: { 'cut-off': 8 } } });
    // The run page lists its model calls by id and reads each one once.
    const { ids } = (await (await app.request(`/runs/${runId}/steps/ids`)).json()) as { ids: string[] };
    const read = await app.request(`/projects/${run.projectId}/run-steps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
    const steps = ((await read.json()) as { rows: { ok: boolean; errorKind: string | null; subjectIds: string[] }[] }).rows;
    const cut = steps.find((step) => step.errorKind === 'cut-off');
    expect(cut).toMatchObject({ ok: false });
    expect(cut!.subjectIds).toHaveLength(8);
  });

  it('shows nothing once the lines are answered', async () => {
    const { db, runId } = setup(8, { mode: 'count', size: 8 });
    const runner = new Runner(db, memoryStore(), model((n) => (n === 1 ? CUT_OFF() : null)).port);
    await runner.drain();
    const app = new Hono<Env>()
      .use(async (context, next) => {
        context.set('deps', { db, runner } as never);
        await next();
      })
      .route('/', workflowRoutes);
    const rows = ((await (await app.request(`/runs/${runId}/items`)).json()) as { rows: { retry: unknown }[] }).rows;
    expect(rows.every((row) => row.retry === null)).toBe(true);
    expect(((await (await app.request(`/runs/${runId}/items?state=retrying`)).json()) as { total: number }).total).toBe(0);
    expect(((await (await app.request(`/runs/${runId}`)).json()) as { retrying: object }).retrying).toEqual({});
  });
});
