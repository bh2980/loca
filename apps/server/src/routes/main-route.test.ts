import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { sourceRoutes } from './source.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes);
  const send = (method: string, url: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const node = (key: string) => db.select().from(s.graphNodes).where(eq(s.graphNodes.key, key)).get()!.id;
  type Row = { key: string; fork?: { nodeId: string; chosen: string; picked: boolean; arms: { nodeId: string; label: string }[] }; restart?: true };
  const list = async (query = '') => (await (await send('GET', `/projects/${projectId}/units?route=main${query}`)).json()) as { total: number; offset: number; rows: Row[] };
  return { db, projectId, send, node, list };
}

describe('script list in route order', () => {
  it('lists the route lines in route order, with the fork on the first line after it', async () => {
    const { projectId, send, node, list } = setup();
    const main = await list();
    const keys = main.rows.map((row) => row.key);
    expect(keys).toEqual(['arrival.1', 'arrival.2', 'arrival.3', 'panel.1', 'panel.2', 'tower.1', 'tower.2', 'tower.3', 'ending.1', 'ending.2', 'ending.3']);
    expect(main.total).toBe(11);
    const fork = main.rows.find((row) => row.key === 'panel.1')!.fork!;
    expect(fork).toMatchObject({ nodeId: node('c.choice'), chosen: node('n.panel.1'), picked: false });
    expect(fork.arms.map((arm) => arm.label)).toEqual(['panel', 'logbook']);
    expect(main.rows.filter((row) => row.fork).map((row) => row.key)).toEqual(['panel.1', 'ending.1']);
    expect(main.rows.some((row) => row.restart)).toBe(false);

    // Without route the list is untouched: script order, every line, no fork field.
    const plain = (await (await send('GET', `/projects/${projectId}/units`)).json()) as { total: number; rows: { key: string; fork?: unknown }[] };
    expect(plain.total).toBe(16);
    expect(plain.rows.some((row) => 'fork' in row)).toBe(false);
  });

  it('keeps filters within the route, and pages and focuses in route order', async () => {
    const { list, projectId, send, db } = setup();
    // logbook lines are not on the route even when they match.
    expect((await list('&q=ignor')).rows.map((row) => row.key)).not.toContain('logbook.2');
    const tower2 = db.select().from(s.units).where(eq(s.units.key, 'tower.2')).get()!;
    const other = db.select({ id: s.statuses.id }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().find((row) => row.id !== tower2.statusId)!.id;
    db.update(s.units).set({ statusId: other }).where(eq(s.units.id, tower2.id)).run();
    expect((await list(`&statusId=${other}`)).rows.map((row) => row.key)).toEqual(['tower.2']);

    // 4 per page: the page holding tower.1 (6th on the route) starts at 4.
    const page = await list(`&limit=4&focus=${db.select().from(s.units).where(eq(s.units.key, 'tower.1')).get()!.id}`);
    expect(page.offset).toBe(4);
    expect(page.rows.map((row) => row.key)).toEqual(['panel.2', 'tower.1', 'tower.2', 'tower.3']);
    const matches = (await (await send('GET', `/projects/${projectId}/units/matches?route=main&q=logbook`)).json()) as { rows: { id: string }[] };
    expect(matches.rows).toHaveLength(0);
  });

  it('PUT picks changes the order, rejects a non-edge, DELETE resets', async () => {
    const { projectId, send, node, list } = setup();
    const put = (body: unknown) => send('PUT', `/projects/${projectId}/route-picks`, body);
    expect((await put({ nodeId: node('c.choice'), armId: node('n.tower.1') })).status).toBe(400);
    expect((await put({ nodeId: node('c.choice'), armId: 'nope' })).status).toBe(400);

    expect((await put({ nodeId: node('c.choice'), armId: node('n.logbook.1') })).status).toBe(200);
    const picked = await list();
    expect(picked.rows.map((row) => row.key).slice(3, 6)).toEqual(['logbook.1', 'logbook.2', 'logbook.3']);
    expect(picked.rows.find((row) => row.key === 'logbook.1')!.fork).toMatchObject({ picked: true, chosen: node('n.logbook.1') });
    const info = (await (await send('GET', `/projects/${projectId}/route`)).json()) as { nodeIds: string[]; steps: [string, string][]; lines: number; forks: number; picks: Record<string, string> };
    expect(info.picks).toEqual({ [node('c.choice')]: node('n.logbook.1') });
    expect(info.steps).toContainEqual([node('c.choice'), node('n.logbook.1')]);
    expect(info.nodeIds).toContain(node('n.logbook.1'));
    expect(info.lines).toBe(picked.total);

    // armId null takes one pick back.
    await put({ nodeId: node('c.choice'), armId: null });
    expect((await list()).rows.map((row) => row.key)).toContain('panel.1');
    await put({ nodeId: node('c.choice'), armId: node('n.logbook.1') });
    expect((await send('DELETE', `/projects/${projectId}/route-picks`)).status).toBe(200);
    expect((await list()).rows.map((row) => row.key)).toContain('panel.1');
    expect(((await (await send('GET', `/projects/${projectId}/route`)).json()) as { picks: object }).picks).toEqual({});
  });
});
