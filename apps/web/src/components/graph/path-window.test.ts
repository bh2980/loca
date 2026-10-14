import { describe, expect, it } from 'vitest';
import { markerId, resolveAt, splitBackEdges, stops, windowOf, type Overview, type OverviewNode } from './path-window';

const anchor = (id: string, extra: Partial<OverviewNode> = {}): OverviewNode => ({ id, kind: 'anchor', nodeIds: [id], unitIds: [id], lanes: 0, choice: false, join: false, ...extra });
const section = (id: string): OverviewNode => ({ id, kind: 'section', nodeIds: [id], unitIds: [id], lanes: 0, choice: false, join: false });
const path = (from: string, to: string) => ({ from, to, label: null, kind: 'path' as const });

// start -> c1 -> s1 -> c2 -> s2 -> c3 -> c4 -> c5 -> c6 ; c1 has a stub that rejoins at c3.
const nodes = [anchor('start'), anchor('c1', { choice: true }), section('s1'), anchor('c2', { choice: true }), section('s2'), anchor('c3', { join: true }), anchor('c4', { choice: true }), anchor('c5', { choice: true }), anchor('c6', { choice: true })];
const overview: Overview = {
  nodes,
  edges: [
    path('start', 'c1'), path('c1', 's1'), path('s1', 'c2'), path('c2', 's2'), path('s2', 'c3'), path('c3', 'c4'), path('c4', 'c5'), path('c5', 'c6'),
    { from: 'c1', to: 'stub:c1:x', label: 'x', kind: 'stub' },
    { from: 'stub:c1:x', to: 'c3', label: null, kind: 'rejoin' },
  ],
};

describe('windowOf', () => {
  it('shows four stops ahead, one back, and the sections between; no stubs', () => {
    const window = windowOf(overview, 'c2', false);
    expect(window.ids).toEqual(expect.arrayContaining(['c1', 's1', 'c2', 's2', 'c3', 'c4', 'c5', 'c6']));
    expect(window.ids.some((id) => id.startsWith('stub:'))).toBe(false);
    expect(window.edges.every((edge) => edge.kind === 'path')).toBe(true);
    expect(window.ids).not.toContain('start');
    expect(window.markers.map((marker) => marker.id)).toEqual([markerId('behind', 'c1')]);
  });
  it('ends at the fifth stop with a marker that leads there', () => {
    const window = windowOf(overview, 'start', false);
    expect(window.ids).not.toContain('c6');
    expect(window.markers).toEqual([{ id: markerId('ahead', 'c5'), target: 'c6', direction: 'ahead' }]);
    expect(window.edges.some((edge) => edge.to === markerId('ahead', 'c5'))).toBe(true);
    expect(window.edges.some((edge) => edge.kind === 'rejoin' || edge.kind === 'stub')).toBe(false);
  });
  it('draws everything for all, and falls back to the first node for an unknown place', () => {
    expect(windowOf(overview, 'c2', true).ids).toHaveLength(nodes.length);
    expect(windowOf(overview, 'c2', true).edges).toHaveLength(8);
    expect(resolveAt(overview, 'gone')).toBe('start');
  });
});

describe('stops', () => {
  it('finds the previous and next choice or join and counts the choices', () => {
    expect(stops(overview, 's1')).toMatchObject({ previous: 'c1', next: 'c2', position: 1, choices: 5 });
    expect(stops(overview, 'start')).toMatchObject({ previous: undefined, next: 'c1', position: 0 });
    expect(stops(overview, 'c6')).toMatchObject({ next: undefined, position: 5 });
  });
});

describe('splitBackEdges', () => {
  it('takes out the edge that closes a loop and keeps the rest', () => {
    const edges = [path('a', 'b'), path('b', 'c'), path('c', 'b'), path('c', 'd')];
    const { forward, back } = splitBackEdges(['a', 'b', 'c', 'd'], edges);
    expect(back).toEqual([path('c', 'b')]);
    expect(forward).toHaveLength(3);
  });
  it('leaves a graph without loops alone, and copes with a cycle that has no start', () => {
    expect(splitBackEdges(['a', 'b'], [path('a', 'b')]).back).toEqual([]);
    expect(splitBackEdges(['a', 'b'], [path('a', 'b'), path('b', 'a')]).back).toHaveLength(1);
  });
});
