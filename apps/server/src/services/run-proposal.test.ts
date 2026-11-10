import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { proposeChange } from './change-gate.ts';
import { importProject } from './importer.ts';
import { prepareProposal } from './proposal-check.ts';
import { proposalDetails } from './proposal-details.ts';
import { decideProposal, listedProposal } from './proposals.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: '내 연결', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ modelLimits: { m: { maxOutput: 1000, by: 'api' } } }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'T' },
    groups: [{ key: 'g', title: '부두' }, { key: 'u', title: '메뉴', kind: 'ui' }],
    units: [{ key: 'a', group: 'g', speaker: 'MIRA', source: 'one' }, { key: 'b', group: 'g', speaker: 'JONAS', source: 'two' }, { key: 'c', group: 'u', kind: 'ui', source: 'Start' }],
    terms: [{ source: 'Relay', target: '중계소' }],
  }), choice);
  db.update(s.connections).set({ projectId }).where(eq(s.connections.id, connection.id)).run();
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => row.name === '번역')!;
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't', permissionMode: 'ask' }).returning().get();
  return { db, projectId, workflow, chat, connection };
}

describe('a proposed run', () => {
  it('says what it would take in and cost, for the scope it was given', async () => {
    const { db, projectId, workflow } = setup();
    const all = await prepareProposal(db, projectId, 'start_run', { workflowId: workflow.id });
    const ui = await prepareProposal(db, projectId, 'start_run', { workflowId: workflow.id, kinds: ['ui'] });
    if (!all.ok || !ui.ok) throw new Error('refused');
    expect(all.report?.run).toMatchObject({ input: 'lines', plan: { lines: { total: 3 } } });
    expect(ui.report?.run?.plan.lines.total).toBe(1);
    expect(ui.report?.run?.plan.totals.calls.max).toBeGreaterThan(0);
  });

  it('is refused when it is proposed if it could not start, instead of failing after a person accepts it', async () => {
    const { db, projectId, workflow } = setup();
    expect(await prepareProposal(db, projectId, 'start_run', { workflowId: workflow.id, q: '이런 글자는 없다' })).toMatchObject({ ok: false, error: '조건에 맞는 대사가 없습니다.' });
    expect(await prepareProposal(db, projectId, 'start_run', { workflowId: workflow.id, statuses: ['없는 상태'] })).toMatchObject({ ok: false, error: expect.stringContaining('상태 없는 상태') });
    expect(await prepareProposal(db, projectId, 'start_run', { workflowId: workflow.id, termIds: ['Relay'] })).toMatchObject({ ok: false });
    expect(await prepareProposal(db, projectId, 'start_run', { workflowId: 'no-such' })).toMatchObject({ ok: false });
  });

  it('tells the agent the size it is about to ask for', async () => {
    const { db, projectId, workflow, chat } = setup();
    const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'start_run', input: { workflowId: workflow.id, kinds: ['ui'] } });
    expect(gate).toMatchObject({ ok: true, applied: false, status: 'pending', text: expect.stringContaining('대상은 1줄입니다') });
  });

  it("reaches the card with its numbers, and the card's ids read as names", async () => {
    const { db, projectId, workflow, chat, connection } = setup();
    const group = db.select().from(s.groups).where(eq(s.groups.key, 'g')).get()!;
    const status = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().find((row) => row.kind === 'initial')!;
    const translate = workflow.definition.nodes.find((node) => node.type === 'ai')!;
    const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'start_run', input: { workflowId: workflow.id, groupIds: [group.id], statuses: [status.id], models: { [translate.id]: { connection: connection.id, model: 'm' } } } });
    if (!gate.ok) throw new Error(gate.error);
    const proposal = db.select().from(s.proposals).where(eq(s.proposals.id, gate.proposalId)).get()!;
    expect(listedProposal(proposal).report?.run?.plan.lines.total).toBe(2);
    expect(proposalDetails(db, proposal)?.refs).toMatchObject({ [workflow.id]: '번역', [group.id]: '부두', [status.id]: status.name, [translate.id]: 'AI 번역', [connection.id]: '내 연결' });
  });

  it('a terms workflow counts terms', async () => {
    const { db, projectId, connection } = setup();
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { input: 'terms' } },
        { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, config: { model: { connectionId: connection.id, model: 'm' }, instructions: 'Decide each term.', output: 'json', scope: 'line', fields: [{ name: 'target', type: 'string' }, { name: 'note', type: 'string' }], batch: { mode: 'count', size: 10 } } },
        { id: 'save', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'saveCandidate', params: { map: { text: 'target', note: 'note' } } } },
      ],
      edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'ai' }, { id: '2', source: 'ai', sourceHandle: 'out', target: 'save' }],
    });
    const terms = db.insert(s.workflows).values({ projectId, name: '용어 번역', description: '', definition }).returning().get();
    expect(await prepareProposal(db, projectId, 'start_run', { workflowId: terms.id, termIds: ['Relay'] })).toMatchObject({ ok: true, report: { run: { input: 'terms', plan: { lines: { total: 1 } } } } });
    // Line scopes do not fit it: said when it is proposed.
    expect(await prepareProposal(db, projectId, 'start_run', { workflowId: terms.id, kinds: ['ui'] })).toMatchObject({ ok: false, error: expect.stringContaining('용어 입력 워크플로') });
  });

  it('once accepted, it runs the scope the card said', async () => {
    const { db, projectId, workflow, chat } = setup();
    const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'start_run', input: { workflowId: workflow.id, kinds: ['ui'] } });
    if (!gate.ok) throw new Error(gate.error);
    const row = await decideProposal(db, gate.proposalId, true);
    expect(row.result).toMatchObject({ ok: true, total: 1 });
    expect(row.report?.run?.plan.lines.total).toBe(1);
  });

  it('starts with the caps the run dialog would suggest, unless it asks for others or none', async () => {
    const { db, projectId, workflow, chat } = setup();
    const started = async (input: Record<string, unknown>) => {
      const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: 'start_run', input: { workflowId: workflow.id, ...input } });
      if (!gate.ok) throw new Error(gate.error);
      const row = await decideProposal(db, gate.proposalId, true);
      const runId = (row.result as { runId: string }).runId;
      return { suggested: row.report?.run?.plan.suggestedLimits, limits: db.select({ limits: s.runs.limits }).from(s.runs).where(eq(s.runs.id, runId)).get()!.limits };
    };
    const plain = await started({ kinds: ['ui'] });
    expect(plain.suggested?.maxCalls).toBeGreaterThan(0);
    // The same numbers as the run dialog's preflight for this scope: one rule, wherever the run starts.
    expect(plain.limits).toEqual(plain.suggested);
    expect((await started({ kinds: ['ui'], limits: { maxCalls: 7 } })).limits).toMatchObject({ maxCalls: 7 });
    expect((await started({ kinds: ['ui'], limits: { maxCalls: null, maxInputTokens: null } })).limits).toBeNull();
  });
});
