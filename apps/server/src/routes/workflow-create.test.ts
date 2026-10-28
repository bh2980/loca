import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { importFileSchema, WORKFLOW_TEMPLATES } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import { importProject } from '../services/importer.ts';
import { workflowRoutes } from './workflows.ts';
vi.mock('../services/layout.ts', () => ({ computeLayouts: vi.fn(async () => {}), cancelViewLayouts: vi.fn() }));
const db = openDatabase(':memory:');
afterEach(() => db.$client.close());

it('creates a blank workflow named 새 워크플로, then 새 워크플로 2, 3 as names are taken; an explicit name is kept', async () => {
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'a', title: 'A' }], units: [{ key: 'one', group: 'a', source: 'One' }] }), null as never);
  const app = new Hono<Env>().use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', workflowRoutes);
  const post = async (body: unknown) => {
    const response = await app.request(`/projects/${projectId}/workflows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; name: string };
  };
  expect((await post({})).name).toBe('새 워크플로');
  expect((await post({})).name).toBe('새 워크플로 2');
  expect((await post({})).name).toBe('새 워크플로 3');
  expect((await post({ name: '복사본' })).name).toBe('복사본');
  const created = await post({});
  const detail = (await (await app.request(`/workflows/${created.id}`)).json()) as { definition: { nodes: { type: string }[] } };
  expect(detail.definition.nodes.map((node) => node.type)).toEqual(['entry']);
});

it('creates from a template with the project\'s status ids; an unknown key is a 400; the name is made unique', async () => {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'a', title: 'A' }], units: [{ key: 'one', group: 'a', source: 'One' }] }), null as never);
  const app = new Hono<Env>().use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', workflowRoutes);
  const post = (body: unknown) => app.request(`/projects/${projectId}/workflows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post({ template: 'nope' })).status).toBe(400);
  const template = WORKFLOW_TEMPLATES[0]!;
  const first = (await (await post({ template: template.key })).json()) as { id: string; name: string };
  // The project's default workflows may already use the template's name: then it gets a number.
  const second = (await (await post({ template: template.key })).json()) as { name: string };
  expect(first.name.startsWith(template.name)).toBe(true);
  expect(second.name.startsWith(template.name)).toBe(true);
  expect(second.name).not.toBe(first.name);
  const detail = (await (await app.request(`/workflows/${first.id}`)).json()) as { definition: { nodes: { id: string }[] } };
  const id = (kind: string) => (db.$client.prepare('select id from statuses where project_id = ? and kind = ? order by sort').get(projectId, kind) as { id: string }).id;
  const built = template.build({ model: { connectionId: '', model: '' }, untranslated: id('initial'), confirmed: id('final'), translated: id('normal') });
  expect(detail.definition.nodes.map((node) => node.id)).toEqual(built.nodes.map((node) => node.id));
  const statusIds = JSON.stringify(detail.definition);
  expect(statusIds.includes(id('initial')) || statusIds.includes(id('final'))).toBe(true);
  db.$client.close();
});
