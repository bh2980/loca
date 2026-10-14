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
    seams: { nodeId: string; from: string }[];
    seamChecks: { checked: number; stale: number; total: number };
    overview: { nodes: { id: string; join: boolean; seam: boolean }[] };
    lines: number;
    totalLines: number;
    picks: Record<string, string>;
  };
  const route = async () => (await (await send('GET', `/projects/${projectId}/route`)).json()) as Slice;
  return { db, projectId, send, node, route };
}

describe('main route API', () => {
  it('GET route returns route 1 (the route through the most lines) with its stubs, forks and no manual picks', async () => {
    const { node, route } = setup();
    const info = await route();
    expect(info.picks).toEqual({});
    expect(info.lines).toBe(12);
    expect(info.totalLines).toBe(16);
    const inSlice = info.blocks.flatMap((block) => block.nodeIds);
    expect(inSlice).toContain(node('n.logbook.1'));
    expect(inSlice).not.toContain(node('n.panel.1'));
    // The choice between panel and logbook: logbook has one more line, so it is route 1 although panel is first in the script; panel becomes a stub.
    const choice = info.forks.find((fork) => fork.nodeId === node('c.choice'))!;
    expect(choice.mode).toBe('choice');
    expect(choice.arms).toEqual([
      { nodeId: node('n.panel.1'), label: 'panel', chosen: false, picked: false },
      { nodeId: node('n.logbook.1'), label: 'logbook', chosen: true, picked: false },
    ]);
    expect(info.stubs).toHaveLength(1);
    expect(info.stubs[0]).toMatchObject({ fork: node('c.choice'), arm: node('n.panel.1'), label: 'panel', lines: 2 });
    // Both arms come back at the join node, which is drawn and marked as a join.
    const joinBlock = info.blocks.find((block) => block.nodeIds.includes(node('j.join')))!;
    expect(info.stubs[0]!.rejoins).toEqual([node('j.join')]);
    expect(info.overview.nodes.find((item) => item.id === joinBlock.id)).toMatchObject({ join: true, seam: false });
    // Route 1 has no seams.
    expect(info.seams).toEqual([]);
    expect(info.seamChecks).toEqual({ checked: 0, stale: 0, total: 0 });
    expect(info.edges).toContainEqual(expect.objectContaining({ to: info.stubs[0]!.id, label: 'panel', kind: 'stub' }));
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

    // A person's pick wins: panel is the shorter arm, yet it is taken.
    expect((await put({ nodeId: node('c.choice'), armId: node('n.panel.1') })).status).toBe(200);
    const info = await route();
    expect(info.picks).toEqual({ [node('c.choice')]: node('n.panel.1') });
    const inSlice = info.blocks.flatMap((block) => block.nodeIds);
    expect(inSlice).toContain(node('n.panel.1'));
    expect(inSlice).not.toContain(node('n.logbook.1'));
    expect(info.stubs).toHaveLength(1);
    expect(info.stubs[0]).toMatchObject({ arm: node('n.logbook.1'), label: 'logbook', lines: 3, rejoins: [node('j.join')] });
    const choice = info.forks.find((fork) => fork.nodeId === node('c.choice'))!;
    expect(choice.arms.find((arm) => arm.nodeId === node('n.panel.1'))).toMatchObject({ chosen: true, picked: true });
    expect(info.lines).toBe(11);

    // armId null takes the pick back: the best route again.
    await put({ nodeId: node('c.choice'), armId: null });
    expect(await route()).toMatchObject({ picks: {}, lines: 12 });
    expect((await route()).stubs[0]).toMatchObject({ arm: node('n.panel.1') });
    await put({ nodeId: node('c.choice'), armId: node('n.panel.1') });
    expect((await send('DELETE', `/projects/${projectId}/route-picks`)).status).toBe(200);
    const reset = await route();
    expect(reset.picks).toEqual({});
    expect(reset.lines).toBe(12);
    expect(reset.stubs[0]).toMatchObject({ arm: node('n.panel.1') });
  });

  it('route 1 does not move while its lines are translated, and a pick still wins over it', async () => {
    const { db, projectId, send, node, route } = setup();
    const before = await route();
    for (const id of before.blocks.flatMap((block) => block.unitIds).slice(0, 5)) db.update(s.units).set({ translation: `번역 ${id}` }).where(eq(s.units.id, id)).run();
    const during = await route();
    expect(during.blocks.map((block) => block.nodeIds)).toEqual(before.blocks.map((block) => block.nodeIds));
    expect(during.lines).toBe(12);
    // Every line of route 1 translated: still route 1 (the next route is a 다음 길 away).
    for (const id of before.blocks.flatMap((block) => block.unitIds)) db.update(s.units).set({ translation: `번역 ${id}` }).where(eq(s.units.id, id)).run();
    expect((await route()).stubs[0]).toMatchObject({ arm: node('n.panel.1') });
    expect((await (await send('GET', `/projects/${projectId}/route/next`)).json()) as { changed: boolean }).toMatchObject({ changed: true });
  });

  it('the slice cache does not go stale when a pick is written straight to projects.routePicks', async () => {
    const { db, projectId, node, route } = setup();
    expect((await route()).stubs[0]).toMatchObject({ arm: node('n.panel.1') });
    db.update(s.projects).set({ routePicks: { [node('c.choice')]: node('n.panel.1') } }).where(eq(s.projects.id, projectId)).run();
    const info = await route();
    expect(info.picks).toEqual({ [node('c.choice')]: node('n.panel.1') });
    expect(info.stubs[0]).toMatchObject({ arm: node('n.logbook.1') });
    expect(info.blocks.flatMap((block) => block.nodeIds)).toContain(node('n.panel.1'));
    db.update(s.projects).set({ routePicks: {} }).where(eq(s.projects.id, projectId)).run();
    expect((await route()).stubs[0]).toMatchObject({ arm: node('n.panel.1') });
  });

  describe('다음 길', () => {
    type Next = { picks: Record<string, string>; newLines: number; totalUntranslatedOnRoute: number; remainingRoutes: number | string; changed: boolean };
    const preview = async (h: ReturnType<typeof setup>) => (await (await h.send('GET', `/projects/${h.projectId}/route/next`)).json()) as Next;
    const info = async (h: ReturnType<typeof setup>) => (await (await h.send('GET', `/projects/${h.projectId}/route`)).json()) as Awaited<ReturnType<ReturnType<typeof setup>['route']>> & { round: number; canGoBack: boolean; translatedLines: number; totalLines: number; graphLines: number; translatedGraphLines: number; newLinesOnRoute: number; blocks: { unitIds: string[]; translated: number }[] };
    /** Fake a finished translation for the lines of the current route. */
    const translateRoute = async (h: ReturnType<typeof setup>) => {
      for (const block of (await info(h)).blocks) for (const id of block.unitIds) h.db.update(s.units).set({ translation: `번역 ${id}` }).where(eq(s.units.id, id)).run();
    };

    it('GET route counts translated lines, the lines the route adds and the round', async () => {
      const h = setup();
      const before = await info(h);
      expect(before).toMatchObject({ round: 1, canGoBack: false, translatedLines: 0, newLinesOnRoute: before.lines });
      const first = before.blocks[0]!;
      h.db.update(s.units).set({ translation: '번역' }).where(eq(s.units.id, first.unitIds[0]!)).run();
      h.db.update(s.units).set({ translation: '   ' }).where(eq(s.units.id, first.unitIds[1] ?? first.unitIds[0]!)).run();
      const after = await info(h);
      // Only a non-empty translation text counts.
      expect(after.translatedLines).toBe(1);
      expect(after.newLinesOnRoute).toBe(after.lines - 1);
      expect(after.blocks[0]!.translated).toBe(1);
      expect(after.translatedGraphLines).toBe(1);
    });

    it('moves to the route with the most untranslated lines after the first route is translated, and back', async () => {
      const h = setup();
      const { node, projectId, send } = h;
      await translateRoute(h);
      const done = await info(h);
      expect(done.newLinesOnRoute).toBe(0);
      const next = await preview(h);
      expect(next).toMatchObject({ changed: true, totalUntranslatedOnRoute: 0, picks: { [node('c.choice')]: node('n.panel.1') } });
      expect(next.newLines).toBeGreaterThan(0);
      expect(next.remainingRoutes).toBe(1);

      expect((await send('POST', `/projects/${projectId}/route/next`, { round: 1 })).status).toBe(200);
      const second = await info(h);
      expect(second).toMatchObject({ round: 2, canGoBack: true, picks: next.picks });
      expect(second.newLinesOnRoute).toBe(next.newLines);
      // The new route covers lines the first did not.
      expect(second.blocks.flatMap((block) => block.nodeIds)).toContain(node('n.panel.1'));

      expect((await send('POST', `/projects/${projectId}/route/prev`, { round: 2 })).status).toBe(200);
      expect(await info(h)).toMatchObject({ round: 1, canGoBack: false, picks: {} });
      expect((await info(h)).stubs[0]).toMatchObject({ arm: node('n.panel.1') });
    });

    it('refuses with Korean messages: a stale round, a route still open, nothing left, nothing to go back to', async () => {
      const h = setup();
      const { projectId, send } = h;
      const post = async (path: string, round: number) => {
        const res = await send('POST', `/projects/${projectId}/route/${path}`, { round });
        return { status: res.status, text: await res.text() };
      };
      expect((await send('POST', `/projects/${projectId}/route/next`, {})).status).toBe(400);
      expect(await post('prev', 1)).toMatchObject({ status: 400, text: expect.stringContaining('이전 길이 없습니다') });
      expect(await post('next', 7)).toMatchObject({ status: 400, text: expect.stringContaining('이미 바뀌었습니다') });
      // Route 1 is the best route, so it stays the next one while it is open.
      expect((await preview(h)).changed).toBe(false);
      expect(await post('next', 1)).toMatchObject({ status: 400, text: expect.stringContaining('먼저 이번 길을 번역') });
      // A person's pick off the best route: a bigger route exists, but this one is still open, so it is still refused.
      await send('PUT', `/projects/${projectId}/route-picks`, { nodeId: h.node('c.choice'), armId: h.node('n.panel.1') });
      expect(await preview(h)).toMatchObject({ changed: true });
      expect((await preview(h)).totalUntranslatedOnRoute).toBeGreaterThan(0);
      expect(await post('next', 1)).toMatchObject({ status: 400, text: expect.stringContaining('먼저 이번 길을 번역') });
      await send('DELETE', `/projects/${projectId}/route-picks`);
      // Everything translated: no route is left.
      h.db.update(s.units).set({ translation: '번역' }).run();
      expect(await preview(h)).toMatchObject({ newLines: 0, remainingRoutes: 0, changed: false });
      expect(await post('next', 1)).toMatchObject({ status: 400, text: expect.stringContaining('더 없습니다') });
    });

    it('DELETE route-picks starts again at round 1', async () => {
      const h = setup();
      await translateRoute(h);
      await h.send('POST', `/projects/${h.projectId}/route/next`, { round: 1 });
      expect((await info(h)).round).toBe(2);
      await h.send('DELETE', `/projects/${h.projectId}/route-picks`);
      expect(await info(h)).toMatchObject({ round: 1, canGoBack: false, picks: {} });
    });
  });

  describe('이음새 점검', () => {
    type Line = { unitId: string; key: string; source: string; translation: string | null };
    type Detail = { nodeId: string; before: { from: string; lines: Line[] }[]; after: Line[]; sig: string; check: { at: string; state: string } | null };
    /** Route 1 translated, then 다음 길: route 2 takes the logbook arm and comes back at the join. */
    const second = async () => {
      const h = setup();
      for (const block of (await h.route()).blocks) for (const id of block.unitIds) h.db.update(s.units).set({ translation: `번역 ${id}` }).where(eq(s.units.id, id)).run();
      expect((await h.send('POST', `/projects/${h.projectId}/route/next`, { round: 1 })).status).toBe(200);
      return h;
    };
    const open = async (h: ReturnType<typeof setup>) => {
      const info = await h.route();
      const seamId = info.seams[0]!.nodeId;
      const detail = (await (await h.send('GET', `/projects/${h.projectId}/route/seams/${encodeURIComponent(seamId)}`)).json()) as Detail;
      return { info, seamId, detail };
    };
    const states = async (h: ReturnType<typeof setup>) => (await (await h.send('GET', `/projects/${h.projectId}/seam-checks`)).json()) as { checks: Record<string, { state: string }>; seamChecks: { checked: number; stale: number; total: number } };

    it('round 1 has no seams and no seam detail', async () => {
      const h = setup();
      expect((await h.route()).seams).toEqual([]);
      expect(await states(h)).toEqual({ checks: {}, seamChecks: { checked: 0, stale: 0, total: 0 } });
      const join = (await h.route()).overview.nodes.find((item) => item.join)!;
      expect((await h.send('GET', `/projects/${h.projectId}/route/seams/${encodeURIComponent(join.id)}`)).status).toBe(404);
    });

    type ListData = { blocks: { unitIds: string[]; earlier: boolean }[]; translatedMask: string; seamAround: { nodeId: string; before: { from: string; unitIds: string[] }[]; after: string[] }[] };
    const listData = async (h: ReturnType<typeof setup>) => (await h.route()) as unknown as ListData;

    it('gives the translation list its mask, earlier blocks, seam lines and rows by id', async () => {
      const h = setup();
      const round1 = await listData(h);
      const ids = round1.blocks.flatMap((block) => block.unitIds);
      expect(round1.translatedMask).toBe('0'.repeat(ids.length));
      expect(round1.seamAround).toEqual([]);
      expect(round1.blocks.some((block) => block.earlier)).toBe(false);
      // One line translated: its place in the mask (block order) turns to 1.
      h.db.update(s.units).set({ translation: '번역' }).where(eq(s.units.id, ids[2]!)).run();
      expect((await listData(h)).translatedMask).toBe('001'.padEnd(ids.length, '0'));
      // Rows come back in the order asked, only this project's lines; unknown ids are left out.
      const rows = (await (await h.send('POST', `/projects/${h.projectId}/units/by-ids`, { ids: [ids[2]!, 'nope', ids[0]!] })).json()) as { rows: { id: string; translation: string | null }[] };
      expect(rows.rows.map((row) => row.id)).toEqual([ids[2], ids[0]]);
      expect(rows.rows[0]!.translation).toBe('번역');
      expect((await h.send('POST', `/projects/${h.projectId}/units/by-ids`, { ids: [] })).status).toBe(200);
      // Round 2: route 1's blocks are earlier ones, and the seam's lines are the ones the seam pane reads.
      for (const id of ids) h.db.update(s.units).set({ translation: `번역 ${id}` }).where(eq(s.units.id, id)).run();
      expect((await h.send('POST', `/projects/${h.projectId}/route/next`, { round: 1 })).status).toBe(200);
      const round2 = await listData(h);
      expect(round2.blocks.some((block) => block.earlier)).toBe(true);
      expect(round2.blocks.every((block) => !block.earlier || block.unitIds.every((id) => ids.includes(id)))).toBe(true);
      const { seamId, detail } = await open(h);
      expect(round2.seamAround).toEqual([{ nodeId: seamId, before: [{ from: expect.any(String), unitIds: detail.before[0]!.lines.map((line) => line.unitId) }], after: detail.after.map((line) => line.unitId) }]);
    });

    it('route 2 rejoining route 1 has one seam at the rejoin; going back removes it', async () => {
      const h = await second();
      const { info, seamId, detail } = await open(h);
      const joinBlock = info.blocks.find((block) => block.nodeIds.includes(h.node('j.join')))!;
      expect(info.seams).toEqual([{ nodeId: joinBlock.id, from: expect.any(String) }]);
      expect(info.overview.nodes.find((item) => item.id === seamId)).toMatchObject({ seam: true });
      expect(info.seamChecks).toEqual({ checked: 0, stale: 0, total: 1 });
      // The new side holds route 2's own lines, the earlier side starts at the join.
      expect(detail.nodeId).toBe(seamId);
      expect(detail.before).toHaveLength(1);
      expect(detail.before[0]!.lines.length).toBeGreaterThan(0);
      expect(detail.before[0]!.lines.length).toBeLessThanOrEqual(2);
      expect(detail.after.length).toBeGreaterThan(0);
      expect(detail.after.length).toBeLessThanOrEqual(2);
      expect(detail.after[0]!.translation).toContain('번역');
      expect(detail.check).toBeNull();
      await h.send('POST', `/projects/${h.projectId}/route/prev`, { round: 2 });
      expect((await h.route()).seams).toEqual([]);
    });

    it('PUT marks checked, a changed translation makes it stale, DELETE takes it back', async () => {
      const h = await second();
      const { seamId, detail } = await open(h);
      const url = `/projects/${h.projectId}/seam-checks/${encodeURIComponent(seamId)}`;
      expect((await states(h)).checks).toEqual({});
      expect((await h.send('PUT', url, { sig: detail.sig })).status).toBe(200);
      expect(await states(h)).toMatchObject({ checks: { [seamId]: { state: 'checked' } }, seamChecks: { checked: 1, stale: 0, total: 1 } });
      expect((await h.route()).seamChecks).toEqual({ checked: 1, stale: 0, total: 1 });
      expect((await open(h)).detail.check).toMatchObject({ state: 'checked' });

      // A translation of a line the seam shows changes: the mark stays but reads 바뀜.
      const unitId = detail.after[0]!.unitId;
      h.db.update(s.units).set({ translation: '다른 번역' }).where(eq(s.units.id, unitId)).run();
      expect(await states(h)).toMatchObject({ checks: { [seamId]: { state: 'stale' } }, seamChecks: { checked: 0, stale: 1, total: 1 } });
      const again = (await open(h)).detail;
      expect(again.check).toMatchObject({ state: 'stale' });
      expect(again.sig).not.toBe(detail.sig);
      expect((await h.send('PUT', url, { sig: again.sig })).status).toBe(200);
      expect((await states(h)).seamChecks).toEqual({ checked: 1, stale: 0, total: 1 });

      expect((await h.send('DELETE', url)).status).toBe(200);
      expect(await states(h)).toEqual({ checks: {}, seamChecks: { checked: 0, stale: 0, total: 1 } });
    });

    it('PUT refuses a bad body, a node that is no seam, and a signature that is out of date', async () => {
      const h = await second();
      const { seamId } = await open(h);
      const url = `/projects/${h.projectId}/seam-checks/${encodeURIComponent(seamId)}`;
      const bad = await h.send('PUT', url, {});
      expect(bad.status).toBe(400);
      expect(await bad.text()).toContain('입력이 올바르지 않습니다');
      const none = await h.send('PUT', `/projects/${h.projectId}/seam-checks/nope`, { sig: 'x' });
      expect(none.status).toBe(400);
      expect(await none.text()).toContain('이음새가 아닙니다');
      const old = await h.send('PUT', url, { sig: 'stale' });
      expect(old.status).toBe(400);
      expect(await old.text()).toContain('바뀌었습니다');
      expect((await states(h)).checks).toEqual({});
    });
  });
});
