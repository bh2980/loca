import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import { importProject } from '../services/importer.ts';
import { workflowRoutes } from './workflows.ts';
vi.mock('../services/layout.ts', () => ({ computeLayouts: vi.fn(async () => {}), cancelViewLayouts: vi.fn() }));
const db = openDatabase(':memory:');
afterEach(() => db.$client.close());

it('lists the workflows that call a workflow (calledBy) and refuses to delete it while any does', async () => {
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'a', title: 'A' }], units: [{ key: 'one', group: 'a', source: 'One' }] }), null as never);
  const app = new Hono<Env>().use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', workflowRoutes);
  const json = { 'content-type': 'application/json' };
  const create = async (name: string) => (await (await app.request(`/projects/${projectId}/workflows`, { method: 'POST', headers: json, body: JSON.stringify({ name }) })).json()) as { id: string; version: number; definition: { nodes: unknown[] } };
  const inner = await create('안쪽');
  const outer = await create('바깥');
  const detail = async (id: string) => (await (await app.request(`/workflows/${id}`)).json()) as { version: number; calledBy: { id: string; name: string }[] };
  expect((await detail(inner.id)).calledBy).toEqual([]);

  const withCall = { ...outer.definition, nodes: [...outer.definition.nodes, { id: 'c', type: 'call', position: { x: 0, y: 0 }, config: { workflowId: inner.id } }] };
  const put = await app.request(`/workflows/${outer.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ name: '바깥', description: '', definition: withCall, version: outer.version }) });
  expect(put.status).toBe(200);
  expect((await detail(inner.id)).calledBy).toEqual([{ id: outer.id, name: '바깥' }]);
  // The caller itself is not "called by" itself.
  expect((await detail(outer.id)).calledBy).toEqual([]);

  const refused = await app.request(`/workflows/${inner.id}`, { method: 'DELETE' });
  expect(refused.status).toBe(400);
  expect(await refused.text()).toContain('이 워크플로를 부르는 곳이 있습니다: 바깥. 그곳에서 호출을 지운 뒤 지우세요.');

  // Without the call the workflow can be deleted.
  const saved = await detail(outer.id);
  await app.request(`/workflows/${outer.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ name: '바깥', description: '', definition: outer.definition, version: saved.version }) });
  expect((await app.request(`/workflows/${inner.id}`, { method: 'DELETE' })).status).toBe(200);
});
