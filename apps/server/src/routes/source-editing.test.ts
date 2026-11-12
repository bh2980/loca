import { afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { importFileSchema, type LineFilterInput } from '@tw/shared';
import { onError, type Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';
vi.mock('../services/layout.ts', () => ({ computeLayouts: vi.fn(async () => {}), cancelViewLayouts: vi.fn() }));
const db = openDatabase(':memory:');
afterEach(() => db.$client.close());

type UnitListResponse = { total: number; ids: string[]; offset: number };
type UnitMatchesResponse = { rows: Array<{ id: string; groupId: string; statusBy: string; tagIds: string[] }> };
type GroupResponse = { id: string };
type UnitResponse = { id: string };
async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  return body as T;
}

it('supports source document CRUD from an empty kind and applies chapter scope to lists, counts, focus, and matches', async () => {
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Scoped source' }, groups: [{ key: 'a', title: 'A', section: 'Chapter 1' }, { key: 'b', title: 'B', section: 'Chapter 2' }], units: [{ key: 'one', group: 'a', source: 'One' }, { key: 'two', group: 'b', source: 'Two' }] }), null as never);
  const app = new Hono<Env>().onError(onError).use(async (c, next) => { c.set('deps', { db } as never); await next(); }).route('/', sourceRoutes);
  const base = `/projects/${projectId}`;
  const send = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  // The list endpoints take the one line filter as JSON.
  const ids = async (filter: LineFilterInput, focus?: string) => responseJson<UnitListResponse>(await send('POST', `${base}/units/ids`, { filter, focus }));
  const scoped = await ids({ sections: ['Chapter 2'] });
  expect(scoped.total).toBe(1);
  expect(db.select({ source: s.units.source }).from(s.units).where(eq(s.units.id, scoped.ids[0])).get()?.source).toBe('Two');
  const focused = await ids({ sections: ['Chapter 2'], limit: 1 }, scoped.ids[0]);
  expect(focused.offset).toBe(0);
  db.insert(s.tags).values({ id: 'filter-tag', projectId, name: 'Review', color: 'slate' }).run();
  db.insert(s.unitTags).values({ unitId: scoped.ids[0], tagId: 'filter-tag' }).run();
  const matches = await responseJson<UnitMatchesResponse>(await send('POST', `${base}/units/matches`, { filter: { sections: ['Chapter 2'] } }));
  expect(matches.rows.map((row) => row.id)).toEqual([scoped.ids[0]]);
  expect(matches.rows[0]).toMatchObject({ groupId: expect.any(String), statusBy: expect.any(String), tagIds: ['filter-tag'] });
  expect((await ids({ groupKind: 'document' })).total).toBe(0);
  const groupResponse = await send('POST', `${base}/groups`, { kind: 'document', title: 'Letter' });
  expect(groupResponse.status).toBe(201);
  const group = await responseJson<GroupResponse>(groupResponse);
  const created = await send('POST', `${base}/units`, { groupId: group.id, source: 'Dear reader' });
  expect(created.status).toBe(201);
  const unit = await responseJson<UnitResponse>(created);
  expect((await ids({ groupKind: 'document' })).total).toBe(1);
  expect((await send('PATCH', `${base}/units/${unit.id}/source`, { source: 'Revised letter' })).status).toBe(200);
  expect((await send('DELETE', `${base}/units/${unit.id}`)).status).toBe(200);
  expect((await send('DELETE', `${base}/groups/${group.id}`)).status).toBe(200);
  expect((await ids({ groupKind: 'document' })).total).toBe(0);
});
