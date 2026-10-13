import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, withRunModels, type AiNode } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from './agent-catalog.ts';
import { importProject } from './importer.ts';
import { planRun } from './run-plan.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  const own = db.insert(s.connections).values({ kind: 'openai', name: 'Own', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const other = db.insert(s.connections).values({ kind: 'openai', name: 'Other', baseUrl: 'http://localhost:2/v1' }).returning().get();
  // Every AI node of every workflow runs on Own (sharing with Other) unless a run says otherwise.
  for (const workflow of db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all()) {
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, model: { connectionId: own.id, model: 'own-model' }, extraModels: [{ connectionId: other.id, model: 'shared' }] } } : node)) };
    db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
  }
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => row.definition.nodes.some((node) => node.type === 'ai'))!;
  return { db, projectId, own, other, workflow };
}

describe("a run's own models", () => {
  it('replace a node\'s model and the models it shares with, and leave the workflow alone', () => {
    const { workflow, other } = setup();
    const ai = workflow.definition.nodes.find((node): node is AiNode => node.type === 'ai')!;
    const changed = withRunModels(workflow.definition, { [ai.id]: { connectionId: other.id, model: 'other-model' } });
    expect(changed.nodes.find((node) => node.id === ai.id)).toMatchObject({ config: { model: { connectionId: other.id, model: 'other-model' }, extraModels: [] } });
    expect(ai.config.model.model).toBe('own-model');
    expect(withRunModels(workflow.definition, undefined)).toBe(workflow.definition);
  });

  it('are named for the CLI and chat (node or "*", connection by name) and change the plan', async () => {
    const { db, projectId, workflow } = setup();
    const plain = await planRun(db, projectId, { workflow: workflow.id });
    const picked = await planRun(db, projectId, { workflow: workflow.id, models: { '*': { connection: 'other', model: 'other-model' } } });
    if (!plain.ok || !picked.ok) throw new Error('plan failed');
    expect(plain.nodes.every((node) => node.model?.includes('own-model'))).toBe(true);
    expect(picked.nodes.every((node) => node.model?.includes('other-model') && node.sharedWith.length === 0)).toBe(true);
    expect(await planRun(db, projectId, { workflow: workflow.id, models: { '*': { connection: 'nope', model: 'x' } } })).toMatchObject({ ok: false, error: expect.stringContaining('nope') });
  });

  it('go into the run started from the chat, not into the workflow', async () => {
    const { db, projectId, workflow, other } = setup();
    const start = agentCatalog(db, projectId).find((tool) => tool.name === 'start_run')!;
    const result = (await start.run({ workflowId: workflow.id, ignoreStatus: true, models: { '*': { connection: other.id, model: 'other-model' } } })) as { ok: boolean; runId?: string };
    expect(result.ok).toBe(true);
    const run = db.select().from(s.runs).where(eq(s.runs.id, result.runId!)).get()!;
    expect(Object.values(run.models).flatMap((snapshot) => snapshot.routes.map((route) => route.model))).toEqual(expect.arrayContaining(['other-model']));
    expect(Object.values(run.models).flatMap((snapshot) => snapshot.routes.map((route) => route.model))).not.toContain('own-model');
    expect(db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!.definition.nodes.find((node) => node.type === 'ai')).toMatchObject({ config: { model: { model: 'own-model' } } });
  });
});
