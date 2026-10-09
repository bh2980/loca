import { describe, expect, it } from 'vitest';
import { deriveSceneEdges, reduceSceneEdges } from './scene-graph.ts';

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
