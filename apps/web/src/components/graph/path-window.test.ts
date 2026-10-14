import { describe, expect, it } from 'vitest';
import { foldTranslated, markerId, resolveAt, splitBackEdges, stops, windowOf, type Overview, type OverviewNode } from './path-window';

const anchor = (id: string, extra: Partial<OverviewNode> = {}): OverviewNode => ({ id, kind: 'anchor', blockIds: [id], nodeIds: [id], unitIds: [id], lanes: 0, choice: false, join: false, ...extra });
const section = (id: string): OverviewNode => ({ id, kind: 'section', blockIds: [id], nodeIds: [id], unitIds: [id], lanes: 0, choice: false, join: false });
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
  it('ends after four stops ahead with a marker that leads on', () => {
    const window = windowOf(overview, 'start', false);
    expect(window.ids).not.toContain('c5');
    expect(window.markers).toEqual([{ id: markerId('ahead', 'c4'), target: 'c5', direction: 'ahead' }]);
    expect(window.edges.some((edge) => edge.to === markerId('ahead', 'c4'))).toBe(true);
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

describe('foldTranslated', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const line = [path('a', 'b'), path('b', 'c'), path('c', 'd'), path('d', 'e'), path('e', 'f')];
  const none = new Set<string>();

  it('folds a run of foldable nodes into one and joins the edges around it', () => {
    const result = foldTranslated(ids, line, (id) => ['b', 'c', 'd'].includes(id), none);
    expect(result.ids).toEqual(['a', 'fold:b', 'e', 'f']);
    expect(result.folds).toEqual([{ id: 'fold:b', members: ['b', 'c', 'd'] }]);
    expect(result.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(['a>fold:b', 'fold:b>e', 'e>f']);
  });

  it('leaves a run open when its first node is expanded, and breaks a run at a node that is not foldable', () => {
    expect(foldTranslated(ids, line, (id) => ['b', 'c', 'd'].includes(id), new Set(['b'])).ids).toEqual(ids);
    const result = foldTranslated(ids, line, (id) => id !== 'c', none);
    expect(result.folds.map((fold) => fold.members)).toEqual([['a', 'b'], ['d', 'e', 'f']]);
  });

  it('does not fold across a fork or a meeting of ways', () => {
    // a -> b -> c, a -> d -> c: b and d are alone between a fork and a join.
    const edges = [path('a', 'b'), path('a', 'd'), path('b', 'c'), path('d', 'c')];
    const result = foldTranslated(['a', 'b', 'd', 'c'], edges, (id) => id !== 'a' || true, none);
    expect(result.folds.map((fold) => fold.members)).toEqual([['a'], ['b'], ['d'], ['c']]);
    expect(result.edges).toHaveLength(4);
  });
});
