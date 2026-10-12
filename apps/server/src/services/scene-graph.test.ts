import { describe, expect, it } from 'vitest';
import { deriveSceneEdges, deriveSceneGraph, reduceSceneEdges } from './scene-graph.ts';

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
