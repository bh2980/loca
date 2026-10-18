import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';
vi.mock('../services/layout.ts', () => ({ computeLayouts: vi.fn(async () => {}) }));
const db = openDatabase(':memory:');
afterEach(() => db.$client.close());

type UnitListResponse = { total: number; rows: Array<{ id: string; source: string }>; offset: number };
type UnitMatchesResponse = { rows: Array<{ id: string; groupId: string; statusBy: string; tagIds: string[] }> };
type GroupResponse = { id: string };
type UnitResponse = { id: string };
async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  return body as T;
}

it('supports source document CRUD from an empty kind and applies chapter scope to lists, counts, focus, and matches', async () => {
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Scoped source' }, groups: [{ key: 'a', title: 'A', section: 'Chapter 1' }, { key: 'b', title: 'B', section: 'Chapter 2' }], units: [{ key: 'one', group: 'a', source: 'One' }, { key: 'two', group: 'b', source: 'Two' }] }), null as never);
  const app = new Hono<Env>().use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', sourceRoutes);
  const base = `/projects/${projectId}`;
  const send = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const scoped = await responseJson<UnitListResponse>(await app.request(`${base}/units?section=Chapter%202`));
  expect(scoped.total).toBe(1);
  expect(scoped.rows[0].source).toBe('Two');
  const focused = await responseJson<UnitListResponse>(await app.request(`${base}/units?section=Chapter%202&focus=${scoped.rows[0].id}&limit=1`));
  expect(focused.offset).toBe(0);
  db.insert(s.tags).values({ id: 'filter-tag', projectId, name: 'Review', color: 'slate', role: null }).run();
  db.insert(s.unitTags).values({ unitId: scoped.rows[0].id, tagId: 'filter-tag' }).run();
  const matches = await responseJson<UnitMatchesResponse>(await app.request(`${base}/units/matches?section=Chapter%202`));
  expect(matches.rows.map((row) => row.id)).toEqual([scoped.rows[0].id]);
  expect(matches.rows[0]).toMatchObject({ groupId: expect.any(String), statusBy: expect.any(String), tagIds: ['filter-tag'] });
  expect((await responseJson<UnitListResponse>(await app.request(`${base}/units?kind=document`))).total).toBe(0);
  const groupResponse = await send('POST', `${base}/groups`, { kind: 'document', title: 'Letter' });
  expect(groupResponse.status).toBe(201);
  const group = await responseJson<GroupResponse>(groupResponse);
  const created = await send('POST', `${base}/units`, { groupId: group.id, source: 'Dear reader' });
  expect(created.status).toBe(201);
  const unit = await responseJson<UnitResponse>(created);
  expect((await responseJson<UnitListResponse>(await app.request(`${base}/units?kind=document`))).total).toBe(1);
  expect((await send('PATCH', `${base}/units/${unit.id}/source`, { source: 'Revised letter' })).status).toBe(200);
  expect((await send('DELETE', `${base}/units/${unit.id}`)).status).toBe(200);
  expect((await send('DELETE', `${base}/groups/${group.id}`)).status).toBe(200);
  expect((await responseJson<UnitListResponse>(await app.request(`${base}/units?kind=document`))).total).toBe(0);
});
