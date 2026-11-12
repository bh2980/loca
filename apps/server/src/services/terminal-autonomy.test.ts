import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { Runner, type ModelPort } from '../engine/runner.ts';
import { createRun } from '../engine/run-create.ts';
import { agentTools } from './agent-tools.ts';
import { proposeChange, undoChanges } from './change-gate.ts';
import { importProject } from './importer.ts';
import { exportLines } from './script-query.ts';
import { decideProposal } from './proposals.ts';
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

/** An AI step whose error exit sets a status (as the default workflows' 검토 필요로 does): the run finishes every line as done. */
function translateRun(db: ReturnType<typeof setup>['db'], projectId: string, choice: { connectionId: string; model: string }) {
  const at = { x: 0, y: 0 };
  const review = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().find((status) => status.inReview)!;
  const definition = workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: {} },
      { id: 'translate', type: 'ai', position: at, config: { model: choice, instructions: 'Translate.', output: 'text' }, exits: { error: [{ type: 'status', statusId: review.id }] } },
    ],
    edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'translate' }],
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
    const mode = (terminalPermissionMode: 'ask' | 'auto' | 'bypass', permissions = {}) => db.update(s.projects).set({ agentSettings: { ...project.agentSettings, terminalPermissionMode, permissions } }).where(eq(s.projects.id, projectId)).run();
    const undo = async (id: string) => (await undoChanges(db, { terminal: projectId }, [id]))[0]!;
    const carol = () => db.select().from(s.characters).where(eq(s.characters.name, 'Carol')).get();
    expect(await undo(asked.proposalId)).toMatchObject({ ok: false, error: '사람이 수락한 제안이라 앱에서 되돌립니다' });
    const inApp = async (id: string) => (await undoChanges(db, { terminal: projectId, by: 'person' }, [id]))[0]!;
    // The undo is a change like any other: taking Carol out again is a delete, which the agent may not do until deleting is switched on,
    expect(await undo(applied.proposalId)).toMatchObject({ ok: false, error: expect.stringContaining('인물 삭제') });
    // which 매번 묻기 leaves to the person and 자동 검토 never applies without asking.
    mode('ask', { characters: { delete: true } });
    expect(await undo(applied.proposalId)).toMatchObject({ ok: false, error: '터미널 권한 모드가 매번 묻기라 앱에서 되돌립니다' });
    mode('auto', { characters: { delete: true } });
    expect(await undo(applied.proposalId)).toMatchObject({ ok: false, error: expect.stringContaining('삭제·병합은 묻습니다') });
    expect(carol()).toBeDefined();
    expect(db.select().from(s.proposals).where(eq(s.proposals.tool, 'delete_items')).all()).toEqual([]);
    mode('bypass', { characters: { delete: true } });
    expect(await undo(applied.proposalId)).toMatchObject({ ok: true });
    expect(carol()).toBeUndefined();
    expect(db.select().from(s.characters).where(eq(s.characters.name, 'Bob')).get()).toBeDefined();
    // Recorded as what it was: the mode applied it, no person decided.
    expect(db.select().from(s.proposals).where(eq(s.proposals.tool, 'delete_items')).get()).toMatchObject({ status: 'accepted', decidedBy: 'bypass', review: `되돌리기 (proposal ${applied.proposalId})` });
    // What the terminal leaves to the person, the person undoes in the app: theirs, whatever the mode and the agent's permissions are.
    mode('ask');
    expect(await inApp(asked.proposalId)).toMatchObject({ ok: true });
    expect(db.select().from(s.characters).where(eq(s.characters.name, 'Bob')).get()).toBeUndefined();
    expect(db.select().from(s.proposals).where(eq(s.proposals.review, `되돌리기 (proposal ${asked.proposalId})`)).get()).toMatchObject({ status: 'accepted', decidedBy: 'person' });
  });

  it('auto review lets the terminal undo an edit, and a person\'s undo in the app is theirs whatever the mode', async () => {
    const { db, projectId } = setup();
    const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    db.update(s.projects).set({ agentSettings: { ...project.agentSettings, terminalPermissionMode: 'auto' } }).where(eq(s.projects.id, projectId)).run();
    const made = db.insert(s.characters).values({ projectId, name: 'Dana', profile: 'before' }).returning().get();
    const edited = await proposeChange(db, { projectId, sessionId: null, source: 'cli', tool: 'save_character', input: { id: made.id, profile: 'after' }, terminal: true });
    expect(edited).toMatchObject({ ok: true, applied: true });
    if (!edited.ok) throw new Error(edited.error);
    expect(await undoChanges(db, { terminal: projectId }, [edited.proposalId])).toMatchObject([{ ok: true }]);
    expect(db.select().from(s.characters).where(eq(s.characters.id, made.id)).get()?.profile).toBe('before');
    expect(db.select().from(s.proposals).where(eq(s.proposals.review, `되돌리기 (proposal ${edited.proposalId})`)).get()).toMatchObject({ decidedBy: 'auto' });

    // In a conversation: the agent may not delete, the chat asks every time, and the person's undo still deletes what the change made.
    const chat = db.insert(s.chatSessions).values({ projectId, title: 't', permissionMode: 'ask' }).returning().get();
    const created = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name: 'Erin' } });
    if (!created.ok) throw new Error(created.error);
    await decideProposal(db, created.proposalId, true);
    expect(await undoChanges(db, chat.id, [created.proposalId])).toMatchObject([{ ok: true }]);
    expect(db.select().from(s.characters).where(eq(s.characters.name, 'Erin')).get()).toBeUndefined();
    expect(db.select().from(s.proposals).where(eq(s.proposals.review, `되돌리기 (proposal ${created.proposalId})`)).get()).toMatchObject({ decidedBy: 'person', tool: 'delete_items' });
  });
});
