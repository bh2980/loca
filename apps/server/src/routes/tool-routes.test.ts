import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@loca/shared';
import { onError, type Env } from '../http.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { proposalRoutes } from './proposals.ts';
import { scriptRoutes } from './script.ts';

function setup(mode: 'ask' | 'auto' | 'bypass' = 'ask') {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', speaker: 'Alice', source: 'Hi' }, { key: 'b', group: 'g', speaker: 'Bob', source: 'Bye' }] }));
  const settings = (patch: Record<string, unknown>) => {
    const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    db.update(s.projects).set({ agentSettings: { ...project.agentSettings, ...patch } }).where(eq(s.projects.id, projectId)).run();
  };
  settings({ terminalPermissionMode: mode });
  const app = new Hono<Env>().onError(onError)
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', scriptRoutes)
    .route('/', proposalRoutes);
  const post = async (url: string, body: unknown) => {
    const response = await app.request(`/projects/${projectId}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // Without the app's error handler a refusal comes as plain text.
    const text = await response.text();
    return { status: response.status, body: (response.ok ? JSON.parse(text) : { error: text }) as Record<string, any> };
  };
  const line = (key: string) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get()!;
  return { db, projectId, post, settings, line };
}

describe('the terminal\'s tool and import routes', () => {
  it('import answers with the gate\'s own check: a report when nothing changes, a proposal otherwise', async () => {
    const { db, post, settings, line } = setup('bypass');
    const applied = await post('/import', { changes: [{ key: 'a', translation: '안녕' }, { key: 'missing', translation: 'x' }] });
    expect(applied).toMatchObject({ status: 200, body: { total: 2, changes: 1, errors: [{ key: 'missing' }], applied: true, status: 'accepted' } });
    expect(line('a').translation).toBe('안녕');
    // The batch was checked once, by the gate, and the proposal holds what the check kept.
    expect(db.select().from(s.proposals).all()).toMatchObject([{ tool: 'propose_changes', input: { changes: [{ key: 'a' }] }, report: { dropped: [{ key: 'missing' }] } }]);

    // Nothing to change is an answer with the reason in the report, not an error, and makes no proposal.
    expect(await post('/import', { changes: [{ key: 'a', translation: '안녕' }] })).toMatchObject({ status: 200, body: { total: 1, unchanged: 1, changes: 0, proposalId: null } });
    expect(await post('/import', { changes: [{ key: 'missing', translation: 'x' }] })).toMatchObject({ status: 200, body: { total: 1, errors: [{ key: 'missing' }], proposalId: null } });
    expect(await post('/import', { dryRun: true, changes: [{ key: 'b', translation: '잘 가' }] })).toMatchObject({ status: 200, body: { changes: 1, proposalId: null } });
    expect(line('b').translation).toBeNull();
    expect(db.select().from(s.proposals).all()).toHaveLength(1);

    // What the agent may not do is refused by the gate, with the gate's reason.
    settings({ permissions: { script: { update: false } } });
    expect(await post('/import', { changes: [{ key: 'b', translation: '잘 가' }] })).toMatchObject({ status: 400, body: { error: expect.stringContaining('대사 변경') } });
  });

  it('a tool called from the terminal answers with its whole result, however long', async () => {
    const { db, projectId, post } = setup();
    db.insert(s.documents).values(Array.from({ length: 300 }, (_, index) => ({ projectId, kind: 'note' as const, title: `d${index}`, body: 'x'.repeat(300), status: 'confirmed' as const }))).run();
    const read = await post('/tools/read_documents', {});
    expect(read.status).toBe(200);
    expect(read.body.proposed).toBe(false);
    expect(read.body.result).toHaveLength(300);
    expect(JSON.stringify(read.body.result).length).toBeGreaterThan(90_000);

    expect(await post('/tools/read_scene', {})).toMatchObject({ status: 400, body: { error: expect.stringContaining('입력이 맞지 않습니다') } });
    expect(await post('/tools/edit_workflow_node', { workflowId: 'w', nodeId: 'n', field: 'code', value: '' })).toMatchObject({ status: 400, body: { error: expect.stringContaining('없거나 꺼진 도구') } });
    expect(await post('/tools/save_character', { name: 'Bob' })).toMatchObject({ status: 200, body: { proposed: true, applied: false, status: 'pending' } });
  });

  it('a tool the editor carries out is permission-checked on the server before the browser applies it', async () => {
    const { post, settings } = setup();
    const edit = { workflowId: 'w', nodeId: 'n', field: 'instructions', value: 'Translate.' };
    expect(await post('/editor-tools/edit_workflow_node/permission', edit)).toMatchObject({ status: 200, body: { denied: null } });
    settings({ permissions: { workflows: { update: false } } });
    expect(await post('/editor-tools/edit_workflow_node/permission', edit)).toMatchObject({ status: 200, body: { denied: expect.stringContaining('워크플로 변경') } });
    expect(await post('/editor-tools/edit_workflow_node/permission', { nodeId: 'n' })).toMatchObject({ status: 200, body: { denied: expect.stringContaining('입력이 맞지 않습니다') } });
    // Only a tool whose spec says the editor carries it out is answered here.
    expect((await post('/editor-tools/save_workflow/permission', {})).status).toBe(400);
  });
});
