import { describe, expect, it } from 'vitest';
import { foldTranslated, READING_LABEL, markerId, resolveAt, splitBackEdges, stops, windowOf, type Overview, type OverviewNode } from './path-window';

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
    expect(window.edges.some((edge) => (edge.kind as string) === 'rejoin' || (edge.kind as string) === 'stub')).toBe(false);
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
  it('a seam is a stop too', () => {
    const withSeam = [anchor('start'), section('s1'), anchor('m', { seam: true }), section('s2')];
    expect(stops({ nodes: withSeam, edges: [] }, 'start')).toMatchObject({ next: 'm' });
    expect(stops({ nodes: withSeam, edges: [] }, 's2')).toMatchObject({ previous: 'm' });
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

describe('windowOf reads a parallel fan-out as one column', () => {
  // top -> hub; hub -> a1 -> a2 -> join, hub -> b -> join, hub -> c -> join, hub -> join; join -> end. `out` enters hub from outside.
  const labelled = (from: string, to: string, label: string) => ({ from, to, label, kind: 'path' as const });
  const fan: Overview = {
    nodes: [anchor('pre'), anchor('out', { choice: true }), anchor('hub'), section('a1'), section('a2'), section('b'), section('c'), anchor('join', { join: true }), section('end'), section('top')],
    edges: [path('pre', 'out'), path('out', 'hub'), labelled('hub', 'a1', '첫째'), labelled('hub', 'b', '둘째'), labelled('hub', 'c', '셋째'), path('hub', 'join'), path('a1', 'a2'), path('a2', 'join'), path('b', 'join'), path('c', 'join'), path('join', 'end')],
  };
  const win = windowOf(fan, 'hub', false);
  const body = win.ids.filter((id) => !id.startsWith('more:'));

  it('reads each arm to its end in script order, the meeting node after the last arm', () => {
    expect(body).toEqual(['out', 'hub', 'a1', 'a2', 'b', 'c', 'join', 'end']);
  });
  it('draws real edges only between neighbours, the rest as reading connectors', () => {
    const drawn = win.edges.filter((edge) => !edge.from.startsWith('more:')).map((edge) => `${edge.from}>${edge.to}:${edge.kind}`);
    expect(drawn).toEqual(['out>hub:path', 'hub>a1:path', 'a1>a2:path', 'a2>b:reading', 'b>c:reading', 'c>join:path', 'join>end:path']);
    const connector = win.edges.find((edge) => edge.to === 'b')!;
    expect(connector).toMatchObject({ kind: 'reading', arm: true, label: '둘째' });
    expect(READING_LABEL).toBe('같은 자리의 다음 선택지');
    // hub -> join, a2 -> join, b -> join are not drawn.
    expect(win.edges.filter((edge) => edge.to === 'join')).toHaveLength(1);
  });
  it('numbers the arms and leaves the meeting node out of them', () => {
    expect([...win.arms!]).toEqual([['a1', { index: 1, count: 3 }], ['b', { index: 2, count: 3 }], ['c', { index: 3, count: 3 }]]);
  });
  it('keeps one marker above (the entry into the first node) and none for entries mid-window', () => {
    const withSide: Overview = { nodes: [...fan.nodes, anchor('other')], edges: [...fan.edges, path('other', 'join'), path('other', 'b')] };
    const result = windowOf(withSide, 'hub', false);
    expect(result.markers.filter((marker) => marker.direction === 'behind')).toEqual([{ id: markerId('behind', 'out'), target: 'pre', direction: 'behind' }]);
    expect(result.ids.filter((id) => id.startsWith('more:b:'))).toHaveLength(1);
    expect(result.edges.some((edge) => edge.from.startsWith('more:b:') && edge.to !== 'out')).toBe(false);
  });
  it('cuts arms that leave the window with a single marker at the bottom', () => {
    const chain = ['k1', 'k2', 'k3', 'k4', 'k5'];
    const leaving: Overview = {
      nodes: [anchor('hub'), section('a'), section('b'), ...chain.map((id) => anchor(id, { choice: true }))],
      edges: [path('hub', 'a'), path('hub', 'b'), path('a', 'k1'), path('k1', 'k2'), path('k2', 'k3'), path('k3', 'k4'), path('k4', 'k5')],
    };
    const result = windowOf(leaving, 'hub', false);
    expect(result.ids).toEqual(['hub', 'a', 'k1', 'k2', 'k3', 'k4', 'b', markerId('ahead', 'b')]);
    expect(result.markers).toEqual([{ id: markerId('ahead', 'b'), target: 'k5', direction: 'ahead' }]);
    expect(result.edges.at(-1)).toMatchObject({ from: 'b', kind: 'reading' });
  });
  it('a loop back is not drawn and does not reorder the column', () => {
    const loop: Overview = { nodes: [anchor('hub'), section('a'), section('b')], edges: [path('hub', 'a'), path('hub', 'b'), path('a', 'hub'), path('b', 'hub')] };
    const result = windowOf(loop, 'hub', false);
    expect(result.ids).toEqual(['hub', 'a', 'b']);
    expect(result.back).toHaveLength(2);
    expect(result.edges.map((edge) => edge.kind)).toEqual(['path', 'reading']);
  });
  it('a fold does not run across a reading connector or a fork', () => {
    const result = windowOf(fan, 'hub', false);
    const folded = foldTranslated(result.ids, result.edges, (id) => !id.startsWith('more:'), new Set());
    expect(folded.folds.map((fold) => fold.members)).toEqual([['out', 'hub'], ['a1', 'a2'], ['b'], ['c'], ['join', 'end']]);
  });
});
