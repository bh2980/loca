import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { memoryStore } from '../services/secrets.ts';
import { chatRoutes } from './chat.ts';
import { workflowRoutes } from './workflows.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'API', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const file = importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'Hello' }] });
  const { projectId } = importProject(db, file);
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db, secrets: memoryStore() } as never);
      await next();
    })
    .route('/', chatRoutes)
    .route('/', workflowRoutes)
    .onError((error, c) => (error instanceof HTTPException ? c.json({ error: error.message }, error.status) : c.json({ error: String(error) }, 500)));
  const post = (path: string, body: unknown = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { db, connection, projectId, post };
}

describe('where a model comes from when something new is made', () => {
  it('starts a new chat with the model of the project\'s latest chat', async () => {
    const { db, connection, projectId, post } = setup();
    db.insert(s.chatSessions).values({ projectId, title: '오래된', connectionId: connection.id, model: 'old', updatedAt: new Date(1_000) }).run();
    db.insert(s.chatSessions).values({ projectId, title: '최근', connectionId: connection.id, model: 'recent', effort: 'low', updatedAt: new Date(2_000) }).run();
    const response = await post(`/projects/${projectId}/chat`);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ connectionId: connection.id, model: 'recent', effort: 'low' });
  });

  it('starts a new chat without a model when the project has no chat to copy it from, and takes the one it is told', async () => {
    const { connection, projectId, post } = setup();
    expect(await (await post(`/projects/${projectId}/chat`)).json()).toMatchObject({ connectionId: null, model: null });
    expect(await (await post(`/projects/${projectId}/chat`, { model: { connectionId: connection.id, model: 'asked' } })).json()).toMatchObject({ connectionId: connection.id, model: 'asked' });
  });

  it('leaves the model of every AI node empty in a workflow made from a template', async () => {
    const { projectId, post } = setup();
    for (const template of ['translation', 'people']) {
      const row = (await (await post(`/projects/${projectId}/workflows`, { template })).json()) as { definition: { nodes: { type: string; config: { model?: unknown } }[] } };
      const models = row.definition.nodes.filter((node) => node.type === 'ai').map((node) => node.config.model);
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) expect(model).toMatchObject({ connectionId: '', model: '' });
    }
  });

  it('gives a project\'s starting workflows no model either', () => {
    const { db, projectId } = setup();
    const nodes = db.select().from(s.workflows).all().filter((workflow) => workflow.projectId === projectId).flatMap((workflow) => workflow.definition.nodes);
    const models = nodes.flatMap((node) => (node.type === 'ai' ? [node.config.model] : []));
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) expect(model).toMatchObject({ connectionId: '', model: '' });
  });
});
