import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { routeGraph, walkRoute } from './route-slice.ts';
import { bestRoute, nextRoute, previewNext, untranslatedWeights } from './next-route.ts';
import { routeCoverage, throughPicks } from './route-coverage.ts';
import { sourceRoutes } from '../routes/source.ts';

type N = { id: string; key: string; kind: string; unitIds: string[] };
const node = (id: string, kind: string, ...unitIds: string[]): N => ({ id, key: id, kind, unitIds });
const edge = (from: string, to: string, label: string | null = null) => ({ from, to, label });
const units = new Map(Array.from({ length: 20 }, (_, i) => [`u${i + 1}`, { seq: i + 1 }] as const));

/**
 * start → F ⟨a | b⟩; a → end; b → G ⟨g1 | g2⟩; g2 → H ⟨h1 | h2⟩; g1, h1, h2 → end; orphan has no way in from a start.
 * H comes before G in the node list, so the local search (one switch plus the forks it opens, in list
 * order) never looks at H's arms: the untranslated line behind it (u7) is the nested branch it misses.
 */
function nested() {
  const ns = [node('H', 'condition'), node('start', 'script', 'u1'), node('F', 'condition'), node('a', 'script', 'u2'), node('b', 'script', 'u3'), node('G', 'condition'), node('g1', 'script', 'u4'), node('g2', 'script', 'u5'), node('h1', 'script', 'u6'), node('h2', 'script', 'u7'), node('end', 'script', 'u9'), node('orphan', 'script', 'u8'), node('orphan2', 'script', 'u10')];
  const es = [edge('start', 'F'), edge('F', 'a', 'Stay'), edge('F', 'b', 'Leave'), edge('a', 'end'), edge('b', 'G'), edge('G', 'g1'), edge('G', 'g2'), edge('g2', 'H'), edge('H', 'h1'), edge('H', 'h2'), edge('g1', 'end'), edge('h1', 'end'), edge('h2', 'end'), edge('orphan', 'orphan2'), edge('orphan2', 'orphan')];
  const g = routeGraph(ns, es, units);
  const untranslated = new Set(['u7', 'u8']);
  return { g, weights: untranslatedWeights(ns, (id) => !untranslated.has(id)) };
}

describe('route coverage', () => {
  it('the local search alone misses the nested branch; the fallback finds it', () => {
    const { g, weights } = nested();
    expect(bestRoute(g, weights, {}).lines).toBe(0);
    const next = nextRoute(g, weights, {});
    expect(next.lines).toBe(1);
    expect(walkRoute(g, next.picks).inSlice.has('h2')).toBe(true);
    const preview = previewNext(g, weights, {});
    expect(preview).toMatchObject({ newLines: 1, changed: true, totalUntranslatedOnRoute: 0, remainingRoutes: 1 });
  });

  it('remaining branches group what the route does not pass by the choice it leaves at; unreachable lines are counted apart', () => {
    const { g, weights } = nested();
    const coverage = routeCoverage(g, weights, {});
    expect(coverage.branches).toEqual([{ fork: 'F', arm: 'b', label: 'Leave', untranslated: 1, lines: 5, firstNode: 'h2' }]);
    expect(coverage.branchLines).toBe(1);
    expect(coverage.unreachable).toBe(1);
    // On the route through h2 nothing reachable is left.
    expect(routeCoverage(g, weights, { F: 'b', G: 'g2', H: 'h2' }).branches).toEqual([]);
  });

  it('throughPicks picks every choice on the shortest way to the target and nothing else; null when no route reaches it', () => {
    const { g } = nested();
    expect(throughPicks(g, {}, 'h2')).toEqual({ F: 'b', G: 'g2', H: 'h2' });
    expect(throughPicks(g, {}, 'end')).toEqual({});
    expect(throughPicks(g, {}, 'orphan')).toBeNull();
    expect(throughPicks(g, {}, 'missing')).toBeNull();
  });
});

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
  const get = async <T,>(url: string) => (await (await send('GET', url)).json()) as T;
  type Remaining = { branches: { fork: string; arm: string; untranslated: number; firstNode: string }[]; branchLines: number; unreachable: number };
  type Route = { blocks: { nodeIds: string[]; unitIds: string[] }[]; round: number; graphLines: number };
  return { db, projectId, send, remaining: () => get<Remaining>(`/projects/${projectId}/route/remaining`), route: () => get<Route>(`/projects/${projectId}/route`), next: () => get<{ newLines: number }>(`/projects/${projectId}/route/next`) };
}
const translate = (db: ReturnType<typeof openDatabase>, ids: string[]) => db.update(s.units).set({ translation: '번역' }).where(inArray(s.units.id, ids)).run();

describe('route coverage API (relay-station)', () => {
  it('lists the branches route 1 leaves, and 이 갈래로 moves the route there: same round while it has new lines, the next round once it is translated', async () => {
    const { db, projectId, send, remaining, route } = setup();
    const first = await remaining();
    expect(first.unreachable).toBe(0);
    expect(first.branches.length).toBeGreaterThan(0);
    const routeLines = (await route()).blocks.flatMap((block) => block.unitIds).length;
    expect(first.branchLines + routeLines).toBe((await route()).graphLines);
    const target = first.branches[0]!.firstNode;

    // Route 1 still has new lines: only this round's choices change.
    const stay = await send('POST', `/projects/${projectId}/route/through`, { nodeId: target, round: 1 });
    expect(await stay.json()).toMatchObject({ round: 1, advanced: false });
    expect((await route()).blocks.flatMap((block) => block.nodeIds)).toContain(target);
    await send('DELETE', `/projects/${projectId}/route-picks`);

    // Translated route 1: the next round, with route 1 in the history.
    translate(db, (await route()).blocks.flatMap((block) => block.unitIds));
    const stale = await send('POST', `/projects/${projectId}/route/through`, { nodeId: target, round: 3 });
    expect(stale.status).toBe(400);
    const moved = await send('POST', `/projects/${projectId}/route/through`, { nodeId: target, round: 1 });
    expect(await moved.json()).toMatchObject({ round: 2, advanced: true });
    const two = await route();
    expect(two.round).toBe(2);
    expect(two.blocks.flatMap((block) => block.nodeIds)).toContain(target);
    expect((await remaining()).branches.map((branch) => branch.firstNode)).not.toContain(target);

    // Translate along the remaining branches one by one: nothing is missed.
    for (let guard = 0; guard < 20; guard++) {
      translate(db, (await route()).blocks.flatMap((block) => block.unitIds));
      const left = await remaining();
      if (!left.branches.length) break;
      const { round } = await route();
      expect((await send('POST', `/projects/${projectId}/route/through`, { nodeId: left.branches[0]!.firstNode, round })).status).toBe(200);
    }
    const graphUnits = db.select({ unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().flatMap((row) => row.unitIds);
    const done = db.select({ id: s.units.id, translation: s.units.translation }).from(s.units).where(inArray(s.units.id, graphUnits)).all();
    expect(done.every((unit) => unit.translation)).toBe(true);
  });

  it('a node no route reaches is refused', async () => {
    const { projectId, send } = setup();
    const res = await send('POST', `/projects/${projectId}/route/through`, { nodeId: 'nope', round: 1 });
    expect(res.status).toBe(400);
  });
});
