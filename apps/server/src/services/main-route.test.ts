import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { projectRoute, walkRoute } from './main-route.ts';

/** A graph from "a>b" / "a>b:label" edges; every node holds one line "<id>" whose seq is its order in `ids`, unless it is in `bare`. */
function graph(ids: string[], edgeSpecs: string[], bare: string[] = []) {
  const nodes = ids.map((id) => ({ id, key: id, unitIds: bare.includes(id) ? [] : [`u.${id}`] }));
  const units = new Map(ids.filter((id) => !bare.includes(id)).map((id, seq) => [`u.${id}`, { seq, source: `say ${id}` }]));
  const edges = edgeSpecs.map((spec) => {
    const [pair, label] = spec.split(':');
    const [from, to] = pair!.split('>');
    return { from: from!, to: to!, label: label ?? null };
  });
  return { nodes, edges, units };
}
const walk = (ids: string[], edgeSpecs: string[], picks: Record<string, string> = {}, bare: string[] = []) => {
  const g = graph(ids, edgeSpecs, bare);
  return walkRoute(g.nodes, g.edges, g.units, picks);
};
const lines = (route: { unitIds: string[] }) => route.unitIds.map((id) => id.slice(2));

describe('walkRoute', () => {
  it('walks a straight line', () => {
    const route = walk(['a', 'b', 'c'], ['a>b', 'b>c']);
    expect(route.nodeIds).toEqual(['a', 'b', 'c']);
    expect(lines(route)).toEqual(['a', 'b', 'c']);
    expect(route.forkBefore.size).toBe(0);
    expect(route.restarts.size).toBe(0);
  });

  it('takes the first arm in script order at a choice; the other arm stays off the route', () => {
    // Listed out of order on purpose: x is later in the script than y but earlier in the edge list.
    const ids = ['a', 'y', 'x', 'j'];
    const route = walk(ids, ['a>x:late', 'a>y', 'x>j', 'y>j']);
    expect(lines(route)).toEqual(['a', 'y', 'j']);
    // The fork belongs to the first line after it, with both arms: the edge label if any, else the target's first line.
    expect(route.forkBefore.get('u.y')).toEqual({ nodeId: 'a', chosen: 'y', picked: false, arms: [{ nodeId: 'y', label: 'say y' }, { nodeId: 'x', label: 'late' }] });
    expect(route.forkBefore.size).toBe(1);
  });

  it('lets picks override the arm', () => {
    const route = walk(['a', 'y', 'x', 'j'], ['a>y', 'a>x', 'x>j', 'y>j'], { a: 'x' });
    expect(lines(route)).toEqual(['a', 'x', 'j']);
    expect(route.forkBefore.get('u.x')).toMatchObject({ chosen: 'x', picked: true });
    // A pick that is no way out of the node is ignored.
    expect(lines(walk(['a', 'y', 'x', 'j'], ['a>y', 'a>x', 'x>j', 'y>j'], { a: 'j' }))).toEqual(['a', 'y', 'j']);
  });

  it('visits every spoke of a hub in script order, then the exit, recording each return as a fork at the hub', () => {
    // hub -> s1 -> hub, hub -> s2 -> hub, hub -> out
    const route = walk(['hub', 's1', 's2', 'out'], ['hub>s1', 'hub>s2', 'hub>out', 's1>hub', 's2>hub']);
    expect(lines(route)).toEqual(['hub', 's1', 's2', 'out']);
    expect(route.forkBefore.get('u.s1')).toMatchObject({ nodeId: 'hub', chosen: 's1' });
    expect(route.forkBefore.get('u.s2')).toMatchObject({ nodeId: 'hub', chosen: 's2' });
    expect(route.forkBefore.get('u.out')).toMatchObject({ nodeId: 'hub', chosen: 'out' });
    expect(route.forkBefore.get('u.out')!.arms.map((arm) => arm.nodeId)).toEqual(['s1', 's2', 'out']);
  });

  it('resumes after a join into heard lines at the latest place with an arm into script not yet reached', () => {
    // a -> b -> c -> a (back into heard lines); b also leads to d, which is further in the script.
    const route = walk(['a', 'b', 'c', 'd'], ['a>b', 'b>c', 'c>a', 'b>d']);
    expect(lines(route)).toEqual(['a', 'b', 'c', 'd']);
    expect(route.forkBefore.get('u.d')).toMatchObject({ nodeId: 'b', chosen: 'd' });
    expect(route.restarts.size).toBe(0);
  });

  it('starts again at the next starting point and records the restart', () => {
    const route = walk(['a', 'b', 'c', 'd'], ['a>b', 'c>d']);
    expect(lines(route)).toEqual(['a', 'b', 'c', 'd']);
    expect([...route.restarts]).toEqual(['u.c']);
    // The first start is not a restart, and a restart is no edge taken.
    expect(route.steps).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('starts a graph that is one loop where the script starts', () => {
    const route = walk(['a', 'b', 'c'], ['a>b', 'b>c', 'c>a']);
    expect(route.nodeIds).toEqual(['a', 'b', 'c']);
    expect(route.restarts.size).toBe(0);
  });

  it('keeps steps as the consecutive edges taken', () => {
    const route = walk(['a', 'b', 'c', 'x', 'j'], ['a>b', 'b>c', 'b>x', 'c>j', 'x>j']);
    expect(route.nodeIds).toEqual(['a', 'b', 'c', 'j']);
    expect(route.steps).toEqual([['a', 'b'], ['b', 'c'], ['c', 'j']]);
    for (const [i, [from, to]] of route.steps.entries()) {
      expect(route.nodeIds[i]).toBe(from);
      expect(route.nodeIds[i + 1]).toBe(to);
    }
  });

  it('places a node without lines by the first line after it', () => {
    // A bare choice node: its arms still read in script order.
    const route = walk(['a', 'c', 'y', 'x'], ['a>c', 'c>x', 'c>y'], {}, ['c']);
    expect(lines(route)).toEqual(['a', 'y', 'x']);
  });
});

describe('projectRoute on the relay station sample', () => {
  function setup() {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
    const { projectId } = importProject(db, file);
    const key = new Map(db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((row) => [row.id, row.key]));
    return { db, projectId, keys: (ids: string[]) => ids.map((id) => key.get(id)!) };
  }

  it('runs from arrival.1 to the ending, and a stored pick changes it (the cache does not go stale)', () => {
    const { db, projectId, keys } = setup();
    const first = keys(projectRoute(db, projectId).unitIds);
    expect(first[0]).toBe('arrival.1');
    expect(first.at(-1)).toMatch(/^ending\./);
    expect(first).toContain('panel.1');
    expect(first).not.toContain('logbook.1');
    expect(projectRoute(db, projectId)).toBe(projectRoute(db, projectId));

    const choice = db.select().from(s.graphNodes).where(eq(s.graphNodes.key, 'c.choice')).get()!;
    const logbook = db.select().from(s.graphNodes).where(eq(s.graphNodes.key, 'n.logbook.1')).get()!;
    db.update(s.projects).set({ routePicks: { [choice.id]: logbook.id } }).where(eq(s.projects.id, projectId)).run();
    const second = keys(projectRoute(db, projectId).unitIds);
    expect(second).toContain('logbook.1');
    expect(second).not.toContain('panel.1');
    expect(second.at(-1)).toMatch(/^ending\./);
  });
});
