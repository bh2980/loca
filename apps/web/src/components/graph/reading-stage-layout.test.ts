import { describe, expect, it } from 'vitest';
import { readingStageLayout } from './reading-stage-layout';

describe('story stage orientation', () => {
  for (const direction of ['vertical', 'horizontal'] as const) it(`keeps parallel content in one stage and connects its boundaries: ${direction}`, () => {
    const { nodes, edges } = readingStageLayout(['start', 'parallel:all-arms', 'end'], direction);
    expect(nodes.map((node) => node.id)).toEqual(['start', 'parallel:all-arms', 'end']);
    expect(new Set(nodes.map((node) => direction === 'vertical' ? node.x : node.y)).size).toBe(1);
    expect(edges.map((edge) => [edge.from, edge.to])).toEqual([['start', 'parallel:all-arms'], ['parallel:all-arms', 'end']]);
    for (const [index, edge] of edges.entries()) {
      const source = nodes[index]!, target = nodes[index + 1]!;
      expect(edge.points).toEqual(direction === 'vertical'
        ? [source.x + 140, source.y + 104, target.x + 140, target.y]
        : [source.x + 280, source.y + 52, target.x, target.y + 52]);
    }
  });
});
