import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { analysisTemplate, importFileSchema } from '@tw/shared';
import { onError, type Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRun } from '../engine/run-create.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/model-target.ts';
import { workflowRoutes } from './workflows.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', speaker: 'A', source: 'Hi' }] });
  const { projectId } = importProject(db, file, choice);
  const analysis = (name: string) => {
    const workflow = db.insert(s.workflows).values({ projectId, name, definition: analysisTemplate({ model: choice }) }).returning().get();
    return createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} }).runId;
  };
  const setStatus = (id: string, status: 'running' | 'paused' | 'completed') => db.update(s.runs).set({ status, notice: null }).where(eq(s.runs.id, id)).run();
  const runOf = (id: string) => db.select().from(s.runs).where(eq(s.runs.id, id)).get()!;
  // The routes go on with a run through the service (services/run-continue.ts); the runner only pauses and cancels.
  const app = new Hono<Env>().onError(onError)
    .use(async (c, next) => {
      c.set('deps', { db, runner: {} } as never);
      await next();
    })
    .route('/', workflowRoutes);
  const post = (url: string, body: unknown = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { db, analysis, setStatus, runOf, post };
}

describe('continuing or resuming a work analysis while another runs', () => {
  it('is refused, as starting a second one is', async () => {
    const { analysis, setStatus, runOf, post } = setup();
    // A failed analysis is a finished (or paused) run with failed lines.
    const failed = analysis('분석 1');
    setStatus(failed, 'completed');
    const running = analysis('분석 2');
    setStatus(running, 'running');

    const refused = await post(`/runs/${failed}/continue`);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('이미 진행 중');
    expect(runOf(failed).status).toBe('completed');

    setStatus(running, 'paused');
    setStatus(failed, 'running');
    const resumed = await post(`/runs/${running}/resume`);
    expect(resumed.status).toBe(400);
    expect(await resumed.text()).toContain('이미 진행 중');
    expect(runOf(running).status).toBe('paused');
  });

  it('goes on when no other analysis runs (the run itself does not count)', async () => {
    const { analysis, setStatus, runOf, post } = setup();
    const paused = analysis('분석 1');
    setStatus(paused, 'paused');
    expect((await post(`/runs/${paused}/resume`)).status).toBe(200);
    expect(runOf(paused).status).toBe('running');
    setStatus(paused, 'completed');
    const response = await post(`/runs/${paused}/continue`);
    expect((await response.text())).not.toContain('이미 진행 중');
  });
});

describe('going on with new caps', () => {
  it('resume takes the body\'s limits (null clears one) and refuses a bad one', async () => {
    const { db, analysis, setStatus, runOf, post } = setup();
    const paused = analysis('분석 1');
    setStatus(paused, 'paused');
    db.update(s.runs).set({ limits: { maxCalls: 4, maxInputTokens: 1_000, hit: 'calls' } }).where(eq(s.runs.id, paused)).run();
    expect((await post(`/runs/${paused}/resume`, { limits: { maxCalls: 50, maxInputTokens: null } })).status).toBe(200);
    expect(runOf(paused)).toMatchObject({ status: 'running', limits: { maxCalls: 50 } });
    setStatus(paused, 'paused');
    expect((await post(`/runs/${paused}/resume`, { limits: { maxCalls: 0 } })).status).toBe(400);
    expect(runOf(paused)).toMatchObject({ status: 'paused', limits: { maxCalls: 50 } });
  });

  it('continue takes them too, like the continue_run tool: the same service answers both', async () => {
    const { db, analysis, setStatus, runOf, post } = setup();
    const paused = analysis('분석 1');
    setStatus(paused, 'paused');
    db.update(s.runs).set({ limits: { maxCalls: 4, hit: 'calls' } }).where(eq(s.runs.id, paused)).run();
    const response = await post(`/runs/${paused}/continue`, { retryFailed: true, limits: { maxCalls: 40 } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, retried: 0, changes: [] });
    expect(runOf(paused)).toMatchObject({ status: 'running', limits: { maxCalls: 40 } });
    expect(runOf(paused).continuations).toHaveLength(1);
    // A run that is going is not continued again.
    const again = await post(`/runs/${paused}/continue`, {});
    expect(again.status).toBe(400);
    expect(await again.text()).toContain('일시정지');
  });
});
