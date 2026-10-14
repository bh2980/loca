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
  type Slice = {
    blocks: { id: string; nodeIds: string[]; unitIds: string[]; kind: string }[];
    edges: { from: string; to: string; label: string | null; kind: 'path' | 'stub' | 'rejoin' }[];
    forks: { nodeId: string; mode: 'choice' | 'parallel'; arms: { nodeId: string; label: string; chosen: boolean; picked: boolean }[] }[];
    stubs: { id: string; fork: string; arm: string; label: string; lines: number; rejoins: string[] }[];
    joins: string[];
    lines: number;
    totalLines: number;
    picks: Record<string, string>;
  };
  const route = async () => (await (await send('GET', `/projects/${projectId}/route`)).json()) as Slice;
  return { db, projectId, send, node, route };
}

describe('main route API', () => {
  it('GET route returns the default slice with its stubs, forks and no picks', async () => {
    const { node, route } = setup();
    const info = await route();
    expect(info.picks).toEqual({});
    expect(info.lines).toBe(11);
    expect(info.totalLines).toBe(16);
    const inSlice = info.blocks.flatMap((block) => block.nodeIds);
    expect(inSlice).toContain(node('n.panel.1'));
    expect(inSlice).not.toContain(node('n.logbook.1'));
    // The choice between panel and logbook: panel is first in the script, logbook becomes a stub.
    const choice = info.forks.find((fork) => fork.nodeId === node('c.choice'))!;
    expect(choice.mode).toBe('choice');
    expect(choice.arms).toEqual([
      { nodeId: node('n.panel.1'), label: 'panel', chosen: true, picked: false },
      { nodeId: node('n.logbook.1'), label: 'logbook', chosen: false, picked: false },
    ]);
    expect(info.stubs).toHaveLength(1);
    expect(info.stubs[0]).toMatchObject({ fork: node('c.choice'), arm: node('n.logbook.1'), label: 'logbook', lines: 3 });
    // Both arms come back at the join node, which is drawn and marked as a join.
    const joinBlock = info.blocks.find((block) => block.nodeIds.includes(node('j.join')))!;
    expect(info.stubs[0]!.rejoins).toEqual([node('j.join')]);
    expect(info.joins).toContain(joinBlock.id);
    expect(info.edges).toContainEqual(expect.objectContaining({ to: info.stubs[0]!.id, label: 'logbook', kind: 'stub' }));
    expect(info.edges).toContainEqual(expect.objectContaining({ from: info.stubs[0]!.id, to: joinBlock.id, kind: 'rejoin' }));
    // The wait node that opens the repeat and the dawn event runs in parallel: no stub for it.
    expect(info.forks.find((fork) => fork.nodeId === node('w.signal'))?.mode).toBe('parallel');
    expect(info.blocks.flatMap((block) => block.unitIds)).toHaveLength(info.lines);
  });

  it('PUT picks switch which arm is the stub, reject a non-edge, DELETE resets', async () => {
    const { projectId, send, node, route } = setup();
    const put = (body: unknown) => send('PUT', `/projects/${projectId}/route-picks`, body);
    expect((await put({ nodeId: node('c.choice'), armId: node('n.tower.1') })).status).toBe(400);
    expect((await put({ nodeId: node('c.choice'), armId: 'nope' })).status).toBe(400);
    expect((await route()).picks).toEqual({});

    expect((await put({ nodeId: node('c.choice'), armId: node('n.logbook.1') })).status).toBe(200);
    const info = await route();
    expect(info.picks).toEqual({ [node('c.choice')]: node('n.logbook.1') });
    const inSlice = info.blocks.flatMap((block) => block.nodeIds);
    expect(inSlice).toContain(node('n.logbook.1'));
    expect(inSlice).not.toContain(node('n.panel.1'));
    expect(info.stubs).toHaveLength(1);
    expect(info.stubs[0]).toMatchObject({ arm: node('n.panel.1'), label: 'panel', lines: 2, rejoins: [node('j.join')] });
    const choice = info.forks.find((fork) => fork.nodeId === node('c.choice'))!;
    expect(choice.arms.find((arm) => arm.nodeId === node('n.logbook.1'))).toMatchObject({ chosen: true, picked: true });
    expect(info.lines).toBe(12); // the logbook arm has one line more than the panel arm

    // armId null takes one pick back.
    await put({ nodeId: node('c.choice'), armId: null });
    expect(await route()).toMatchObject({ picks: {} });
    expect((await route()).stubs[0]).toMatchObject({ arm: node('n.logbook.1') });
    await put({ nodeId: node('c.choice'), armId: node('n.logbook.1') });
    expect((await send('DELETE', `/projects/${projectId}/route-picks`)).status).toBe(200);
    const reset = await route();
    expect(reset.picks).toEqual({});
    expect(reset.lines).toBe(11);
    expect(reset.stubs[0]).toMatchObject({ arm: node('n.logbook.1') });
  });

  it('the slice cache does not go stale when a pick is written straight to projects.routePicks', async () => {
    const { db, projectId, node, route } = setup();
    expect((await route()).stubs[0]).toMatchObject({ arm: node('n.logbook.1') });
    db.update(s.projects).set({ routePicks: { [node('c.choice')]: node('n.logbook.1') } }).where(eq(s.projects.id, projectId)).run();
    const info = await route();
    expect(info.picks).toEqual({ [node('c.choice')]: node('n.logbook.1') });
    expect(info.stubs[0]).toMatchObject({ arm: node('n.panel.1') });
    expect(info.blocks.flatMap((block) => block.nodeIds)).toContain(node('n.logbook.1'));
    db.update(s.projects).set({ routePicks: {} }).where(eq(s.projects.id, projectId)).run();
    expect((await route()).stubs[0]).toMatchObject({ arm: node('n.logbook.1') });
  });

  describe('join checks', () => {
    type Detail = { nodeId: string; routes: { id: string; kind: string; label: string | null; before: { unitId: string; key: string; source: string; translation: string | null }[] }[]; after: { unitId: string }[]; sig: string; check: { at: string; state: string } | null };
    const open = async (h: ReturnType<typeof setup>) => {
      const info = await h.route();
      const joinId = info.joins[0]!;
      const detail = (await (await h.send('GET', `/projects/${h.projectId}/route/joins/${encodeURIComponent(joinId)}`)).json()) as Detail;
      return { joinId, detail };
    };
    const states = async (h: ReturnType<typeof setup>) => ((await (await h.send('GET', `/projects/${h.projectId}/join-checks`)).json()) as { checks: Record<string, { state: string }> }).checks;

    it('GET join lists the chosen path and the other choice with their last lines, then the lines after', async () => {
      const h = setup();
      const { joinId, detail } = await open(h);
      expect(detail.nodeId).toBe(joinId);
      expect(detail.routes.map((route) => route.kind)).toEqual(['path', 'stub']);
      expect(detail.routes[1]!.label).toBe('logbook');
      expect(detail.routes.every((route) => route.before.length > 0 && route.before.length <= 2)).toBe(true);
      expect(detail.after.length).toBeGreaterThan(0);
      expect(detail.check).toBeNull();
      expect((await h.send('GET', `/projects/${h.projectId}/route/joins/nope`)).status).toBe(404);
    });

    it('PUT marks checked, a changed translation makes it stale, DELETE takes it back', async () => {
      const h = setup();
      const { joinId, detail } = await open(h);
      const url = `/projects/${h.projectId}/join-checks/${encodeURIComponent(joinId)}`;
      expect(await states(h)).toEqual({});
      expect((await h.send('PUT', url, { sig: detail.sig })).status).toBe(200);
      expect((await states(h))[joinId]).toMatchObject({ state: 'checked' });
      expect((await open(h)).detail.check).toMatchObject({ state: 'checked' });

      // A translation of a line the join shows changes: the mark stays but reads 바뀜.
      const unitId = detail.routes[1]!.before.at(-1)!.unitId;
      h.db.update(s.units).set({ translation: '다른 번역' }).where(eq(s.units.id, unitId)).run();
      expect((await states(h))[joinId]).toMatchObject({ state: 'stale' });
      const again = (await open(h)).detail;
      expect(again.check).toMatchObject({ state: 'stale' });
      expect(again.sig).not.toBe(detail.sig);
      // Checking again with the new signature makes it current.
      expect((await h.send('PUT', url, { sig: again.sig })).status).toBe(200);
      expect((await states(h))[joinId]).toMatchObject({ state: 'checked' });

      expect((await h.send('DELETE', url)).status).toBe(200);
      expect(await states(h)).toEqual({});
    });

    it('PUT refuses a bad body, a node that is no join, and a signature that is out of date', async () => {
      const h = setup();
      const { joinId } = await open(h);
      const url = `/projects/${h.projectId}/join-checks/${encodeURIComponent(joinId)}`;
      const bad = await h.send('PUT', url, {});
      expect(bad.status).toBe(400);
      expect(await bad.text()).toContain('입력이 올바르지 않습니다');
      const none = await h.send('PUT', `/projects/${h.projectId}/join-checks/nope`, { sig: 'x' });
      expect(none.status).toBe(400);
      expect(await none.text()).toContain('합류 지점이 아닙니다');
      const old = await h.send('PUT', url, { sig: 'stale' });
      expect(old.status).toBe(400);
      expect(await old.text()).toContain('바뀌었습니다');
      expect(await states(h)).toEqual({});
    });
  });
});
