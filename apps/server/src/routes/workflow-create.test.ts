import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import { importProject } from '../services/importer.ts';
import { workflowRoutes } from './workflows.ts';
vi.mock('../services/layout.ts', () => ({ computeLayouts: vi.fn(async () => {}) }));
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
