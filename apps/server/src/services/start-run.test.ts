import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, workflowDefinitionSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { workflowRoutes } from '../routes/workflows.ts';
import { agentTools } from './agent-tools.ts';
import { prepareProposal } from './agent-catalog.ts';
import { importProject } from './importer.ts';
import { resolveRunStart } from './start-run.ts';
import { workflowRows } from './workflow-rows.ts';

const at = { x: 0, y: 0 };

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: '내 연결', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const { projectId } = importProject(db, importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'T' },
    groups: [{ key: 'g', title: '부두' }],
    units: [{ key: 'a', group: 'g', speaker: 'MIRA', source: 'one' }, { key: 'b', group: 'g', speaker: 'JONAS', source: 'two' }],
  }), choice);
  db.update(s.connections).set({ projectId }).where(eq(s.connections.id, connection.id)).run();
  const flow = (model: unknown) =>
    workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: at, config: {} },
        { id: 'translate', type: 'ai', position: at, config: { model, instructions: 'Translate.', output: 'text' } },
      ],
      edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'translate' }],
    });
  const save = (name: string, model: unknown = choice) => db.insert(s.workflows).values({ projectId, name, definition: flow(model) }).returning().get();
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db, runner: {} } as never);
      await next();
    })
    .route('/', workflowRoutes);
  /** The run dialog's start: the refusal as the browser gets it (the status and the message). */
  const fromDialog = async (workflowId: string, body: object) => {
    const response = await app.request(`/workflows/${workflowId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, text: await response.text() };
  };
  /** The start_run tool, as the chat and `loca runs start` call it once accepted. */
  const fromTool = (input: object) =>
    (agentTools(db, projectId) as Record<string, { execute?: (input: never, options: never) => unknown }>).start_run!.execute!(input as never, { toolCallId: 't', messages: [] } as never) as Promise<{ ok: boolean; error?: string; runId?: string }>;
  return { db, projectId, choice, save, fromDialog, fromTool };
}

describe('starting a run', () => {
  it('is refused for the same reasons in the same words from the run dialog, the tool and its proposal', async () => {
    const { db, projectId, save, fromDialog, fromTool } = setup();
    const good = save('좋은 것');
    const broken = save('연결 없는 것', { connectionId: 'gone', model: 'x' });
    const cases: [string, string, object][] = [
      ['a scope with nothing in it', good.id, { filter: { q: 'no line says this' } }],
      ['a workflow with an error', broken.id, {}],
      ['a scope of the other input', good.id, { terms: { emptyTarget: true } }],
      ['a name the project does not have', good.id, { filter: { groups: ['없는 장면'] } }],
    ];
    for (const [what, workflowId, scope] of cases) {
      const dialog = await fromDialog(workflowId, scope);
      const tool = await fromTool({ workflowId, ...scope });
      const proposal = await prepareProposal(db, projectId, 'start_run', { workflowId, ...scope });
      expect(dialog.status, what).toBe(400);
      expect(tool.ok, what).toBe(false);
      expect(dialog.text, what).toContain(tool.error!);
      expect(proposal, what).toMatchObject({ ok: false, error: tool.error });
    }
    expect((await fromTool({ workflowId: good.id, filter: { q: 'no line says this' } })).error).toBe('조건에 맞는 대사가 없습니다.');
    expect((await fromTool({ workflowId: broken.id })).error).toMatch(/^워크플로에 오류가 \d+개 있습니다: /);
    // Nothing was started by any of them.
    expect(db.select().from(s.runs).all()).toEqual([]);
  });

  it('starts the same run from either: the scope resolved, the suggested caps, this run\'s models', async () => {
    const { db, save, fromDialog, fromTool, choice } = setup();
    const workflow = save('번역만');
    const dialog = await fromDialog(workflow.id, { filter: { speakers: ['MIRA'] }, models: { translate: { ...choice, model: 'other' } } });
    expect(dialog.status).toBe(201);
    const tool = await fromTool({ workflowId: workflow.id, filter: { speakers: ['MIRA'] }, models: { translate: { connection: '내 연결', model: 'other' } } });
    expect(tool.ok).toBe(true);
    const [first, second] = db.select().from(s.runs).all();
    expect(first!.scope).toEqual(second!.scope);
    expect(first!.total).toBe(1);
    expect(second!.total).toBe(1);
    expect(first!.limits).toEqual(second!.limits);
    expect(Object.values(first!.models).map((model) => model.target.model)).toEqual(['other']);
    expect(Object.values(second!.models).map((model) => model.target.model)).toEqual(['other']);
  });
});

describe('a stored workflow the schema refuses', () => {
  it('is not read as stored: it lists as unreadable, the others list as they are, and it cannot be started', async () => {
    const { db, projectId, save, fromDialog, fromTool } = setup();
    const good = save('좋은 것');
    const bad = save('깨진 것');
    // Stored JSON that is not a workflow (a node kind that does not exist, settings of the wrong type).
    db.$client.prepare('update workflows set definition = ? where id = ?').run(JSON.stringify({ nodes: [{ id: 'x', type: 'end', position: at, config: {} }], edges: [], settings: { maxVisitsPerNode: 'many' } }), bad.id);

    const rows = workflowRows(db, projectId);
    const listed = rows.find((row) => row.id === bad.id)!;
    expect(listed.errorCount).toBe(1);
    expect(listed.issues).toMatchObject([{ level: 'error', message: expect.stringContaining('저장된 정의를 읽을 수 없습니다') }]);
    // What is read in its place is an empty workflow with the schema's settings, never the stored shape.
    expect(listed.definition).toMatchObject({ nodes: [], edges: [], settings: { maxVisitsPerNode: expect.any(Number), maxConsecutiveFailures: expect.any(Number) } });
    expect(rows.find((row) => row.id === good.id)).toMatchObject({ errorCount: 0, nodeCount: 2 });

    const refusal = resolveRunStart(db, { workflowId: bad.id, scope: { asked: {} } });
    expect(refusal).toMatchObject({ ok: false, error: expect.stringContaining("'깨진 것' 워크플로의 저장된 정의를 읽을 수 없습니다") });
    expect((await fromDialog(bad.id, {})).text).toContain("'깨진 것' 워크플로의 저장된 정의를 읽을 수 없습니다");
    expect((await fromTool({ workflowId: bad.id })).error).toContain("'깨진 것' 워크플로의 저장된 정의를 읽을 수 없습니다");
    expect((await fromTool({ workflowId: good.id })).ok).toBe(true);
  });

  it('reads a stored definition with every setting as the schema gives it', () => {
    const { db, save } = setup();
    const workflow = save('기본값');
    // As a definition saved before a setting existed: no batch, no context, no settings.
    db.$client.prepare('update workflows set definition = ? where id = ?').run(
      JSON.stringify({ nodes: [{ id: 'entry', type: 'entry', position: at, config: {} }, { id: 'translate', type: 'ai', position: at, config: { model: { connectionId: 'c', model: 'm' }, instructions: 'x' } }], edges: [] }),
      workflow.id,
    );
    const read = db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!;
    expect(s.definitionProblem(read.definition)).toBeNull();
    const node = read.definition.nodes[1]!;
    expect(node.type === 'ai' && node.config.batch.mode).toBe('group');
    expect(node.type === 'ai' && typeof node.config.context.precedingLines).toBe('number');
    expect(read.definition.settings.maxConsecutiveFailures).toBe(3);
  });
});
