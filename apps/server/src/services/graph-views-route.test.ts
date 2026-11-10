import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { agentTools } from './agent-tools.ts';
import { listViews, readView, routeNodes, saveView, updateView } from './graph-views.ts';
import { projectReadingRoute } from './reading-route.ts';

// A → a choice of two branches (C1 | C2) → E.
const fixture = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'Route views' },
  groups: [{ key: 'scene', kind: 'scene', title: 'Scene' }],
  units: [
    { key: 'A', group: 'scene', source: 'Start' },
    { key: 'C1', group: 'scene', source: 'Keep going' },
    { key: 'C2', group: 'scene', source: 'Turn back' },
    { key: 'E', group: 'scene', source: 'End' },
  ],
  graph: {
    nodeTypes: { Script: { kind: 'script', label: 'Script' }, Choice: { kind: 'condition', label: 'Choice' } },
    nodes: [
      { key: 'node.A', kind: 'script', type: 'Script', units: ['A'] },
      { key: 'node.choice', kind: 'condition', type: 'Choice', units: [] },
      { key: 'node.C1', kind: 'script', type: 'Script', units: ['C1'] },
      { key: 'node.C2', kind: 'script', type: 'Script', units: ['C2'] },
      { key: 'node.E', kind: 'script', type: 'Script', units: ['E'] },
    ],
    edges: [
      { from: 'node.A', to: 'node.choice' },
      { from: 'node.choice', to: 'node.C1' },
      { from: 'node.choice', to: 'node.C2' },
      { from: 'node.C1', to: 'node.E' },
      { from: 'node.C2', to: 'node.E' },
    ],
  },
});

function setup() {
  const db = openDatabase(':memory:');
  const { projectId } = importProject(db, fixture);
  const ids = new Map(db.select({ id: s.graphNodes.id, key: s.graphNodes.key }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().map((node) => [node.key, node.id]));
  const id = (key: string) => ids.get(key)!;
  return { db, projectId, id };
}

describe('a route view', () => {
  it("holds its route's nodes, and another branch at a fork changes them", () => {
    const { db, projectId, id } = setup();
    const route = { start: id('node.A'), end: id('node.E') };
    const found = routeNodes(db, projectId, route);
    if ('error' in found) throw new Error(found.error);
    const fork = projectReadingRoute(db, projectId, route).forks.find((item) => item.nodeId === id('node.choice'))!;
    const other = fork.options.find((option) => option.targetId !== fork.selectedId)!.targetId;
    const viewId = saveView(db, projectId, found.nodeIds, '길', { origin: 'manual', route });
    expect(readView(db, projectId, viewId)).toMatchObject({ route, nodeIds: [...found.nodeIds].sort() });
    expect(readView(db, projectId, viewId)!.nodeIds).toContain(fork.selectedId);
    expect(listViews(db, projectId)).toMatchObject([{ id: viewId, route }]);

    const changed = updateView(db, projectId, viewId, { via: `${fork.nodeId}:${other}` });
    expect(changed).toMatchObject({ route: { ...route, via: `${fork.nodeId}:${other}` } });
    expect(readView(db, projectId, viewId)!.nodeIds).toContain(other);
    expect(readView(db, projectId, viewId)!.nodeIds).not.toContain(fork.selectedId);
  });

  it('becomes a plain view once nodes are added or left out by hand, and a plain view has no branches to take', () => {
    const { db, projectId, id } = setup();
    const route = { start: id('node.A'), end: id('node.E') };
    const found = routeNodes(db, projectId, route);
    if ('error' in found) throw new Error(found.error);
    const viewId = saveView(db, projectId, found.nodeIds, '길', { origin: 'manual', route });
    expect(updateView(db, projectId, viewId, { label: '새 이름' })).toMatchObject({ route });
    expect(updateView(db, projectId, viewId, { remove: [id('node.E')] })).toMatchObject({ route: null });
    expect(updateView(db, projectId, viewId, { via: 'x:y' })).toMatchObject({ error: expect.stringContaining('경로로 만든 보기가 아니') });
  });

  it('is made by show_graph from a route, never mixed with other picks', async () => {
    const { db, projectId, id } = setup();
    const tools = agentTools(db, projectId) as unknown as Record<string, { execute: (input: unknown) => Promise<Record<string, unknown>> }>;
    const made = await tools.show_graph.execute({ route: { start: 'A', end: 'E' }, mode: 'view', label: '처음부터 끝까지', scenes: [], speakers: [], lines: [], exclude: [], keep: [], around: 0 });
    expect(made).toMatchObject({ ok: true });
    expect(listViews(db, projectId)).toMatchObject([{ label: '처음부터 끝까지', route: { start: id('node.A'), end: id('node.E') } }]);
    expect(await tools.show_graph.execute({ route: { start: 'A', end: 'E' }, mode: 'view', label: 'x', scenes: [], speakers: ['MIRA'], lines: [], exclude: [], keep: [], around: 0 })).toMatchObject({ ok: false });
  });
});
