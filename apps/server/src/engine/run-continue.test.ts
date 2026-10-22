import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, type AiNode } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { continuePreflight, switchedRun } from '../services/run-continue.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { withoutTerms } from './test-workflows.ts';
import { createRun } from './run-create.ts';

function setup() {
  const db = openDatabase(':memory:');
  const conn = (name: string, port: number) => db.insert(s.connections).values({ kind: 'openai', name, baseUrl: `http://localhost:${port}/v1` }).returning().get();
  const a = conn('A', 1);
  const b = conn('B', 2);
  const groups = [{ key: 'g', title: 'G' }];
  const units = Array.from({ length: 4 }, (_, index) => ({ key: `u${index}`, group: 'g', source: `L${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups, units }), { connectionId: a.id, model: 'bad' });
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).get()!;
  const definition = { ...withoutTerms(workflow.definition), nodes: withoutTerms(workflow.definition).nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, batch: { mode: 'count' as const, size: 1, maxTokens: 6_000 } } } : node)) };
  db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
  const runId = createRun(db, { projectId, workflow: { ...workflow, definition }, models: snapshotWorkflowModels(db, definition), scope: {} }).runId;
  const run = () => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;
  return { db, a, b, workflow, runId, run };
}

/** Calls to model "bad" fail for good; any other model translates and passes. */
const port: ModelPort = {
  judge: async () => {
    throw new Error('unused');
  },
  generate: async (route, request) => {
    if ((route as { model: string }).model === 'bad') throw Object.assign(new Error('bad model'), { statusCode: 400 });
    const lines = promptEntries(request.prompt) as { id: string }[];
    const usage = { inputTokens: 10, outputTokens: 5 };
    if (request.system.includes('Review each')) return { object: { results: lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage } as never;
    return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.id}` })) }, usage } as never;
  },
};

describe('continuing a run on other models (#41)', () => {
  it('switches the run, not the workflow, re-queues the failed lines and records which model did what', async () => {
    const { db, b, workflow, runId, run } = setup();
    const runner = new Runner(db, memoryStore(), port);
    await runner.drain();
    expect(run().status).not.toBe('running');
    const ais = run().definition.nodes.filter((node): node is AiNode => node.type === 'ai');
    const models = Object.fromEntries(ais.map((node) => [node.id, { connectionId: b.id, model: 'good' }]));

    const estimate = await continuePreflight(db, run(), models, true);
    expect(estimate).toMatchObject({ ok: true, lines: expect.any(Number) });
    if (estimate.ok) expect(estimate.plan.nodes.every((node) => node.model?.includes('good'))).toBe(true);

    const switched = switchedRun(db, run(), models);
    if (!switched.ok) throw new Error(switched.error);
    expect(switched.changes[0]).toMatchObject({ from: expect.stringContaining('bad'), to: expect.stringContaining('good') });
    const result = runner.continue(runId, { ...switched, retryFailed: true });
    expect(result).toMatchObject({ ok: true });
    await runner.drain();

    expect(run().status).toBe('completed');
    expect(db.select({ state: s.runItems.state }).from(s.runItems).where(eq(s.runItems.runId, runId)).all().every((item) => item.state === 'done')).toBe(true);
    expect(run().continuations).toHaveLength(1);
    const used = new Set(db.select({ model: s.runSteps.model }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).all().map((step) => step.model));
    expect(used).toEqual(new Set(['bad', 'good']));
    const stored = db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!;
    expect(stored.definition.nodes.filter((node): node is AiNode => node.type === 'ai').every((node) => node.config.model.model === 'bad')).toBe(true);
  });

  it('refuses a running or cancelled run and a connection that is gone', () => {
    const { db, a, runId, run } = setup();
    const runner = new Runner(db, memoryStore(), port);
    const same = switchedRun(db, run(), {});
    if (!same.ok) throw new Error(same.error);
    expect(runner.continue(runId, { ...same, retryFailed: false })).toMatchObject({ ok: false, error: expect.stringContaining('일시정지') });
    const ai = run().definition.nodes.find((node) => node.type === 'ai')!;
    expect(switchedRun(db, run(), { [ai.id]: { connectionId: 'gone', model: 'x' } })).toMatchObject({ ok: false });
    runner.cancel(runId);
    expect(runner.continue(runId, { ...same, retryFailed: true })).toMatchObject({ ok: false, error: expect.stringContaining('취소') });
    expect(a).toBeTruthy();
  });
});
