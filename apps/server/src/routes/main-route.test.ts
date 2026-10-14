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
  type Info = { nodeIds: string[]; steps: [string, string][]; lines: number; forks: number; picks: Record<string, string> };
  const route = async () => (await (await send('GET', `/projects/${projectId}/route`)).json()) as Info;
  return { db, projectId, send, node, route };
}

describe('main route API', () => {
  it('GET route returns the default route with its steps and no picks', async () => {
    const { node, route } = setup();
    const info = await route();
    expect(info.picks).toEqual({});
    expect(info.lines).toBe(11);
    expect(info.nodeIds).toContain(node('n.panel.1'));
    expect(info.nodeIds).not.toContain(node('n.logbook.1'));
    expect(info.steps).toContainEqual([node('c.choice'), node('n.panel.1')]);
  });

  it('PUT picks changes the route, rejects a non-edge, DELETE resets', async () => {
    const { projectId, send, node, route } = setup();
    const put = (body: unknown) => send('PUT', `/projects/${projectId}/route-picks`, body);
    expect((await put({ nodeId: node('c.choice'), armId: node('n.tower.1') })).status).toBe(400);
    expect((await put({ nodeId: node('c.choice'), armId: 'nope' })).status).toBe(400);
    expect((await route()).picks).toEqual({});

    expect((await put({ nodeId: node('c.choice'), armId: node('n.logbook.1') })).status).toBe(200);
    const info = await route();
    expect(info.picks).toEqual({ [node('c.choice')]: node('n.logbook.1') });
    expect(info.steps).toContainEqual([node('c.choice'), node('n.logbook.1')]);
    expect(info.nodeIds).toContain(node('n.logbook.1'));
    expect(info.nodeIds).not.toContain(node('n.panel.1'));

    // armId null takes one pick back.
    await put({ nodeId: node('c.choice'), armId: null });
    expect(await route()).toMatchObject({ picks: {} });
    expect((await route()).nodeIds).toContain(node('n.panel.1'));
    await put({ nodeId: node('c.choice'), armId: node('n.logbook.1') });
    expect((await send('DELETE', `/projects/${projectId}/route-picks`)).status).toBe(200);
    const reset = await route();
    expect(reset.picks).toEqual({});
    expect(reset.nodeIds).toContain(node('n.panel.1'));
  });
});
