import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { analysisTemplate, importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRun } from '../engine/run-create.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
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
  const calls: string[] = [];
  const runner = { continue: (id: string) => (calls.push(`continue ${id}`), { ok: true, retried: 0 }), resume: (id: string, limits?: unknown) => calls.push(limits ? `resume ${id} ${JSON.stringify(limits)}` : `resume ${id}`) };
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db, runner } as never);
      await next();
    })
    .route('/', workflowRoutes);
  const post = (url: string, body: unknown = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { analysis, setStatus, post, calls };
}

describe('continuing or resuming a work analysis while another runs', () => {
  it('is refused, as starting a second one is', async () => {
    const { analysis, setStatus, post, calls } = setup();
    // A failed analysis is a finished (or paused) run with failed lines.
    const failed = analysis('분석 1');
    setStatus(failed, 'completed');
    const running = analysis('분석 2');
    setStatus(running, 'running');

    const refused = await post(`/runs/${failed}/continue`);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('이미 진행 중');

    setStatus(running, 'paused');
    setStatus(failed, 'running');
    const resumed = await post(`/runs/${running}/resume`);
    expect(resumed.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('goes on when no other analysis runs (the run itself does not count)', async () => {
    const { analysis, setStatus, post, calls } = setup();
    const paused = analysis('분석 1');
    setStatus(paused, 'paused');
    expect((await post(`/runs/${paused}/resume`)).status).toBe(200);
    setStatus(paused, 'completed');
    const response = await post(`/runs/${paused}/continue`);
    expect((await response.text())).not.toContain('이미 진행 중');
    expect(calls[0]).toBe(`resume ${paused}`);
  });
});

describe('resuming with new caps', () => {
  it('passes the body\'s limits on (null clears one) and refuses a bad one', async () => {
    const { analysis, setStatus, post, calls } = setup();
    const paused = analysis('분석 1');
    setStatus(paused, 'paused');
    expect((await post(`/runs/${paused}/resume`, { limits: { maxCalls: 50, maxInputTokens: null } })).status).toBe(200);
    expect(calls).toEqual([`resume ${paused} {"maxCalls":50,"maxInputTokens":null}`]);
    expect((await post(`/runs/${paused}/resume`, { limits: { maxCalls: 0 } })).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});
