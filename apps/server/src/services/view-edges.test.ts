import { describe, expect, it } from 'vitest';
import { viewEdges } from './layout.ts';

const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to });

describe('viewEdges', () => {
  it('keeps edges between chosen nodes and drops every edge touching a left-out node', () => {
    const { edges, via } = viewEdges(new Set(['a', 'b']), [edge('a', 'b'), edge('b', 'x')]);
    expect(edges.map((e) => e.id)).toEqual(['a-b']);
    expect(via.size).toBe(0);
  });
  it('joins chosen nodes far apart through any left-out nodes, naming what the edge stands for', () => {
    const chain = [edge('a', 'l1'), edge('l1', 'c'), edge('c', 'l2'), edge('l2', 'b')];
    const { edges, via } = viewEdges(new Set(['a', 'b']), chain);
    expect(edges).toEqual([{ id: 'bypass:a:b', from: 'a', to: 'b' }]);
    expect(via.get('bypass:a:b')?.sort()).toEqual(['c', 'l1', 'l2']);
  });
  it('gives each branch its own derived edge', () => {
    const { edges } = viewEdges(new Set(['a', 'b1', 'b2']), [edge('a', 'c'), edge('c', 'b1'), edge('c', 'b2')]);
    expect(edges.map((e) => e.id).sort()).toEqual(['bypass:a:b1', 'bypass:a:b2']);
  });
});
