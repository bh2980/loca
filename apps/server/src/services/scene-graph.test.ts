import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { deriveSceneEdges, deriveSceneGraph, depthBlocks, reduceSceneEdges } from './scene-graph.ts';

describe('scene graph', () => {
  it('derives links through scene-less nodes and stops at the first scene', () => {
    const nodes = [
      { id: 'a', groupId: 'A' },
      { id: 'or', groupId: null },
      { id: 'b', groupId: 'B' },
      { id: 'c', groupId: 'C' },
    ];
    const edges = [
      { fromId: 'a', toId: 'or' },
      { fromId: 'or', toId: 'b' },
      { fromId: 'b', toId: 'c' },
    ];
    expect(deriveSceneEdges(nodes, edges).map((edge) => `${edge.from}${edge.to}`).sort()).toEqual(['AB', 'BC']);
  });

  it('hides only links still reachable through other scenes', () => {
    const { kept, hidden } = reduceSceneEdges([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'A', to: 'C' },
      { from: 'C', to: 'A' },
    ]);
    expect(hidden.map((edge) => `${edge.from}${edge.to}`)).toEqual(['AC']);
    expect(kept).toHaveLength(3);
  });
});

describe('deriveSceneGraph hubs', () => {
  // A menu node outside every scene, reached from and leading to eight scenes; plus a two-scene choice.
  const scenes = Array.from({ length: 8 }, (_, index) => `s${index}`);
  const nodes = [...scenes.flatMap((scene) => [{ id: `${scene}-a`, groupId: scene }, { id: `${scene}-b`, groupId: scene }]), { id: 'menu', groupId: null }, { id: 'choice', groupId: null }];
  const edges = [
    ...scenes.flatMap((scene) => [{ fromId: `${scene}-b`, toId: 'menu' }, { fromId: 'menu', toId: `${scene}-a` }]),
    { fromId: 's0-b', toId: 'choice' },
    { fromId: 'choice', toId: 's1-a' },
  ];

  it('keeps a component that joins many scenes as one hub node instead of linking every pair', () => {
    const graph = deriveSceneGraph(nodes, edges);
    expect(graph.hubs).toEqual([{ id: 'hub:menu', nodeIds: ['menu'], scenes: 8 }]);
    expect(graph.edges.filter((edge) => edge.to === 'hub:menu')).toHaveLength(8);
    expect(graph.edges.filter((edge) => edge.from === 'hub:menu')).toHaveLength(8);
    // Without the hub rule this would be 8 × 7 scene pairs.
    expect(graph.edges.filter((edge) => !edge.from.startsWith('hub:') && !edge.to.startsWith('hub:'))).toEqual([{ from: 's0', to: 's1', weight: 1 }]);
  });

  it('gives previous-scene context only real scene links, not links through a hub', () => {
    expect(deriveSceneEdges(nodes, edges).map((edge) => `${edge.from}>${edge.to}`)).toEqual(['s0>s1']);
  });
});

describe('depth blocks', () => {
  it('rows hub-only scenes by how deep into the flow they start, one block per section', () => {
    // root → a → b; root → c (scene C at depth 1, A at 1, B at 2); D in another section; E never reached.
    const nodes = [
      { id: 'root', groupId: null },
      { id: 'a1', groupId: 'A' },
      { id: 'mid', groupId: null },
      { id: 'b1', groupId: 'B' },
      { id: 'c1', groupId: 'C' },
      { id: 'd1', groupId: 'D' },
      { id: 'loop1', groupId: 'E' },
      { id: 'loop2', groupId: null },
    ];
    const edges = [
      { fromId: 'root', toId: 'a1' },
      { fromId: 'a1', toId: 'mid' },
      { fromId: 'mid', toId: 'b1' },
      { fromId: 'root', toId: 'c1' },
      { fromId: 'root', toId: 'd1' },
      { fromId: 'loop1', toId: 'loop2' },
      { fromId: 'loop2', toId: 'loop1' },
    ];
    const blocks = depthBlocks({ scenes: ['A', 'B', 'C', 'D', 'E'], sections: ['Day 1', 'Day 1', 'Day 1', 'Day 2', 'Day 1'], nodes, edges }, new Set(['A', 'B', 'C', 'D', 'E']));
    expect(blocks).toEqual([
      { name: 'Day 1', rows: [['A', 'C'], ['B'], ['E']] },
      { name: 'Day 2', rows: [['D']] },
    ]);
  });
});

describe('scene graph of the sample project (#54: it showed 그래프가 없습니다)', () => {
  it('links relay-station’s five scenes as its dialogue graph does', () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
    const { projectId } = importProject(db, file);
    const title = new Map(db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).all().map((group) => [group.id, group.title]));
    const nodes = db.select({ id: s.graphNodes.id, groupId: s.graphNodes.groupId }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
    const edges = db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
    const links = deriveSceneEdges(nodes, edges).map((edge) => `${title.get(edge.from)} → ${title.get(edge.to)}`).sort();
    expect(links).toEqual(['근무 일지 → 북쪽 송신탑', '북쪽 송신탑 → 새벽', '중계소 도착 → 근무 일지', '중계소 도착 → 차단기 패널', '차단기 패널 → 북쪽 송신탑']);
  });
});
