import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRun } from '../engine/run-create.ts';
import { Runner, type ModelPort } from '../engine/runner.ts';
import { promptEntries } from '../engine/prompts.ts';
import { translateOnlyWorkflow } from '../engine/test-workflows.ts';
import { importProject } from './importer.ts';
import { snapshotWorkflowModels } from '../domain/model-target.ts';
import { runItemIds, runNodeExits, runProgress } from './run-detail.ts';
import { memoryStore } from '../domain/secrets.ts';

const model: ModelPort = {
  ask: async () => {
    throw new Error('unused');
  },
  generate: async (_target, request) => {
    const lines = promptEntries(request.prompt) as { id: string; source: string }[];
    return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: { inputTokens: 10, outputTokens: 5 } } as never;
  },
};

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ modelLimits: { m: { maxOutput: 1000, by: 'api' } } }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'one' }, { key: 'b', group: 'g', source: 'two' }, { key: 'c', group: 'g', source: 'three' }] }), choice);
  const workflow = translateOnlyWorkflow(db, projectId);
  const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} }).runId;
  return { db, projectId, runId };
}

const query = (over: object) => ({ offset: 0, limit: 100, ...over });

describe("a run's items by node", () => {
  it('a finished line has left every node but its last: "at a node" is where it is now, "through a node" is where it has been', async () => {
    const { db, runId } = setup();
    await new Runner(db, memoryStore(), model).drain();
    expect(runItemIds(db, runId, query({ nodeId: 'translate' })).total).toBe(0);
    expect(runItemIds(db, runId, query({ through: 'translate' })).total).toBe(3);
    expect(runItemIds(db, runId, query({ through: 'save' })).ids).toHaveLength(3);
    expect(runItemIds(db, runId, query({ through: 'nothing-like-it' })).total).toBe(0);
  });

  it('through counts a line waiting at the node, as soon as it has reached it', () => {
    const { db, runId } = setup();
    expect(runItemIds(db, runId, query({ through: 'entry' })).total).toBe(3);
    expect(runItemIds(db, runId, query({ through: 'translate' })).total).toBe(0);
  });

  it('out of one exit: only the lines that left that way', async () => {
    const { db, runId } = setup();
    await new Runner(db, memoryStore(), model).drain();
    expect(runItemIds(db, runId, query({ through: 'translate', exit: 'out' })).total).toBe(3);
    expect(runItemIds(db, runId, query({ through: 'translate', exit: 'error' })).total).toBe(0);
  });

  it("a call's id means the nodes inside it", async () => {
    const { db, runId } = setup();
    db.update(s.runItems).set({ visits: { 'c/inner': 1 } }).where(eq(s.runItems.runId, runId)).run();
    expect(runItemIds(db, runId, query({ through: 'c' })).total).toBe(3);
    expect(runItemIds(db, runId, query({ through: 'c/inner' })).total).toBe(3);
    expect(runItemIds(db, runId, query({ through: 'c/other' })).total).toBe(0);
  });

  it("a node's pane: what reached it, what is there now and what left by each exit", async () => {
    const { db, runId } = setup();
    expect(runNodeExits(db, runId, 'entry')).toEqual({ arrived: 3, here: 3, exits: [] });
    await new Runner(db, memoryStore(), model).drain();
    expect(runNodeExits(db, runId, 'translate')).toEqual({ arrived: 3, here: 0, exits: [{ port: 'out', count: 3 }] });
  });

  it('a line waiting at a node, or sent back to it by a retry rule, has not gone through it yet', () => {
    const { db, projectId, runId } = setup();
    const runner = new Runner(db, memoryStore(), model);
    expect(runProgress(db, runner, projectId, [runId])[0]!.passed).toEqual({});
    const [item] = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    db.update(s.runItems).set({ nodeId: 'translate', visits: { entry: 1, translate: 1 }, data: { ...item!.data, path: [{ nodeId: 'entry', port: 'out', at: 1 }, { nodeId: 'translate', port: 'retry', at: 2 }] } }).where(eq(s.runItems.id, item!.id)).run();
    expect(runProgress(db, runner, projectId, [runId])[0]!.passed).toEqual({ entry: 1 });
  });

  it('what the run graph says went through a node and what opening it lists agree', async () => {
    const { db, projectId, runId } = setup();
    const runner = new Runner(db, memoryStore(), model);
    await runner.drain();
    const { passed } = runProgress(db, runner, projectId, [runId])[0]!;
    for (const [nodeId, count] of Object.entries(passed)) expect(runItemIds(db, runId, query({ through: nodeId })).total).toBe(count);
  });
});
