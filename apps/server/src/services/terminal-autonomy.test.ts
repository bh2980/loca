import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { Runner, type ModelPort } from '../engine/runner.ts';
import { createRun } from '../engine/run-create.ts';
import { agentTools } from './agent-tools.ts';
import { proposeChange } from './change-gate.ts';
import { importProject } from './importer.ts';
import { exportLines } from './script-query.ts';
import { decideProposal, undoProposals } from './proposals.ts';
import { runErrors } from './run-errors.ts';
import { saveView } from './graph-views.ts';
import { viewFlow } from './view-flow.ts';
import { snapshotWorkflowModels } from './routes.ts';
import { memoryStore } from './secrets.ts';

/** A scene that splits on a choice and joins again: a → (b1 | b2) → c. */
function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = ['a', 'b1', 'b2', 'c'].map((key) => ({ key, group: 'g', speaker: 'MIRA', source: `Line ${key}` }));
  const graph = {
    nodes: units.map((unit) => ({ key: `n.${unit.key}`, units: [unit.key] })),
    edges: [
      { from: 'n.a', to: 'n.b1', label: 'Stay' },
      { from: 'n.a', to: 'n.b2', label: 'Leave' },
      { from: 'n.b1', to: 'n.c' },
      { from: 'n.b2', to: 'n.c' },
    ],
  };
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units, graph }), choice);
  return { db, projectId, choice };
}

const tool = (db: ReturnType<typeof setup>['db'], projectId: string, name: string, input: object) =>
  (agentTools(db, projectId) as Record<string, { execute?: (input: never, options: never) => unknown }>)[name]!.execute!(input as never, { toolCallId: 't', messages: [] } as never) as Promise<Record<string, unknown>>;

/** An AI step whose error exit goes straight to the end: the run finishes every line as done. */
function translateRun(db: ReturnType<typeof setup>['db'], projectId: string, choice: { connectionId: string; model: string }) {
  const at = { x: 0, y: 0 };
  const definition = workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: {} },
      { id: 'translate', type: 'ai', position: at, config: { model: choice, instructions: 'Translate.', output: 'text' } },
      { id: 'end', type: 'end', position: at, config: {} },
    ],
    edges: [
      { id: '1', source: 'entry', sourceHandle: 'out', target: 'translate' },
      { id: '2', source: 'translate', sourceHandle: 'out', target: 'end' },
      { id: '3', source: 'translate', sourceHandle: 'error', target: 'end' },
    ],
  });
  const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition }).returning().get();
  return createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} });
}

describe('the terminal working on its own', () => {
  it('finds lines that left through an error exit although the run finished them as done', async () => {
    const { db, projectId, choice } = setup();
    const { runId } = translateRun(db, projectId, choice);
    const port: ModelPort = {
      ask: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        if (request.prompt.includes('Line b2')) throw new Error('connection refused');
        return { object: { lines: [] }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), port).drain();
    const run = db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;
    const items = db.select({ state: s.runItems.state }).from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done')).toBe(true);
    const errors = runErrors(db, run);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => error.nodeId === 'translate')).toBe(true);
    const read = await tool(db, projectId, 'read_run', { runId, errored: true });
    expect((read.errored as { key: string }[]).map((item) => item.key)).toEqual(errors.map((error) => error.key));
    expect((read.errors as { count: number }[]).reduce((sum, error) => sum + error.count, 0)).toBe(errors.length);
  });

  it('continue_run resumes a paused run through the change gate', async () => {
    const { db, projectId, choice } = setup();
    const { runId } = translateRun(db, projectId, choice);
    db.update(s.runs).set({ status: 'paused' }).where(eq(s.runs.id, runId)).run();
    const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    db.update(s.projects).set({ agentSettings: { ...project.agentSettings, terminalPermissionMode: 'bypass' } }).where(eq(s.projects.id, projectId)).run();
    const gate = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: 'continue_run', input: { runId }, terminal: true });
    expect(gate).toMatchObject({ ok: true, applied: true });
    expect(db.select({ status: s.runs.status }).from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('running');
  });

  it('auto review still asks before continuing a run (it costs)', async () => {
    const { db, projectId, choice } = setup();
    const { runId } = translateRun(db, projectId, choice);
    db.update(s.runs).set({ status: 'paused' }).where(eq(s.runs.id, runId)).run();
    const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    db.update(s.projects).set({ agentSettings: { ...project.agentSettings, terminalPermissionMode: 'auto' } }).where(eq(s.projects.id, projectId)).run();
    const gate = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: 'continue_run', input: { runId }, terminal: true });
    expect(gate).toMatchObject({ ok: true, applied: false, status: 'pending' });
  });

  it('reads a saved view along its flow and exports the lines before a join by branch', () => {
    const { db, projectId } = setup();
    const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
    const id = saveView(db, projectId, nodes.map((node) => node.id), '갈래');
    const flow = viewFlow(db, projectId, '갈래');
    expect(flow.view.id).toBe(id);
    expect(flow.nodes.map((node) => node.key)).toEqual(['n.a', 'n.b1', 'n.b2', 'n.c']);
    expect(flow.nodes[0].outgoing.map((way) => way.label)).toEqual(['Stay', 'Leave']);
    const rows = exportLines(db, projectId, { view: '갈래', offset: 0, limit: 200 }, { before: 3, terms: false, all: true });
    expect(rows.map((row) => row.key)).toEqual(['a', 'b1', 'b2', 'c']);
    const joined = rows.find((row) => row.key === 'c') as { before: unknown[]; beforeBranches?: { label: string; lines: { key: string }[] }[] };
    expect(joined.before).toEqual([]);
    expect(joined.beforeBranches?.map((branch) => [branch.label, branch.lines.map((line) => line.key)])).toEqual([
      ['Stay', ['a', 'b1']],
      ['Leave', ['a', 'b2']],
    ]);
  });

  it('the terminal undoes what its mode applied, not what a person accepted', async () => {
    const { db, projectId } = setup();
    const asked = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: 'save_character', input: { name: 'Bob' }, terminal: true });
    if (!asked.ok) throw new Error(asked.error);
    await decideProposal(db, asked.proposalId, true);
    const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    db.update(s.projects).set({ agentSettings: { ...project.agentSettings, terminalPermissionMode: 'bypass' } }).where(eq(s.projects.id, projectId)).run();
    const applied = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: 'save_character', input: { name: 'Carol' }, terminal: true });
    if (!applied.ok) throw new Error(applied.error);
    const results = await undoProposals(db, { terminal: projectId }, [asked.proposalId, applied.proposalId]);
    expect(results.find((result) => result.id === asked.proposalId)).toMatchObject({ ok: false, error: '사람이 수락한 제안이라 앱에서 되돌립니다' });
    expect(results.find((result) => result.id === applied.proposalId)).toMatchObject({ ok: true });
    expect(db.select().from(s.characters).where(eq(s.characters.name, 'Carol')).get()).toBeUndefined();
    expect(db.select().from(s.characters).where(eq(s.characters.name, 'Bob')).get()).toBeDefined();
  });
});
