import { describe, expect, it } from 'vitest';
import { endpointMarkers, flowModel, hiddenEdgeLines, nextWithLines, realNodes, resolveChainEndpoint, stopText, type FlowLayout } from './flow-model';

/**
 * a → [b c d] (folded as chain:b) ─ "가자" (choice x) → e ─┐
 *                                 └ "말자" (choice y) → f ─┴→ g → h → portal:next
 */
const layout: FlowLayout = {
  chains: [{ id: 'chain:b', nodeIds: ['b', 'c', 'd'] }],
  edges: [
    { from: 'a', to: 'chain:b' },
    { from: 'chain:b', to: 'e', via: 'x', label: '가자' },
    { from: 'chain:b', to: 'f', via: 'y', label: '말자' },
    { from: 'e', to: 'g' },
    { from: 'f', to: 'g' },
    { from: 'g', to: 'h', label: '호감도 ≥ 3' },
    { from: 'h', to: 'portal:next' },
  ],
};
const model = flowModel(layout);

describe('what a selection stands for', () => {
  it('a node inside a folded run is drawn as its block and reads with the whole run', () => {
    expect(model.shown('c')).toBe('chain:b');
    expect(model.shown('a')).toBe('a');
    expect(model.flowOf('c')).toEqual(['b', 'c', 'd']);
    expect(model.flowOf('chain:b')).toEqual(['b', 'c', 'd']);
    expect(model.membersOf('chain:b')).toEqual(['b', 'c', 'd']);
    expect(model.membersOf('a')).toEqual(['a']);
  });

  it('a choice reads with the lines it leads to and stands by them', () => {
    expect(model.flowOf('x')).toEqual(['x', 'e']);
    expect(model.anchorOf('x')).toBe('e');
    expect(model.anchorOf('c')).toBe('chain:b');
    expect(model.anchorOf('g')).toBe('g');
  });

  it('a choice leading into a folded run reads the run', () => {
    const folded = flowModel({ chains: [{ id: 'chain:p', nodeIds: ['p', 'q'] }], edges: [{ from: 'o', to: 'chain:p', via: 'pick', label: '문을 연다' }] });
    expect(folded.flowOf('pick')).toEqual(['pick', 'p', 'q']);
    expect(folded.anchorOf('pick')).toBe('chain:p');
  });

  it('gives the real nodes behind drawn ids, once each, without stand-ins', () => {
    expect(realNodes(model, ['chain:b', 'a', 'portal:next', 'a'], (id) => id.startsWith('portal:'))).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('one step along the flow', () => {
  it('follows the single way, onto a choice when the edge is one', () => {
    expect(model.neighbour('a', 1)).toEqual({ target: 'chain:b' });
    expect(model.neighbour('x', 1)).toEqual({ target: 'g' });
    expect(model.neighbour('x', -1)).toEqual({ target: 'chain:b' });
    expect(model.neighbour('g', 1)).toEqual({ target: 'h' });
    expect(model.neighbour('c', -1)).toEqual({ target: 'a' });
  });

  it('stops where the flow forks, merges, begins or ends, and says why', () => {
    expect(model.neighbour('chain:b', 1)).toEqual({ stop: { reason: 'fork', ways: 2 } });
    expect(model.neighbour('g', -1)).toEqual({ stop: { reason: 'merge', ways: 2 } });
    expect(model.neighbour('a', -1)).toEqual({ stop: { reason: 'start' } });
    expect(flowModel({ edges: [] }).neighbour('z', 1)).toEqual({ stop: { reason: 'end' } });
    expect(stopText({ reason: 'fork', ways: 2 })).toContain('2갈래');
    expect(stopText({ reason: 'end' })).toBe('이 흐름의 마지막 대사입니다.');
  });
});

describe('the flow around a selection', () => {
  it('walks until the way forks', () => {
    expect(model.walk('a', 1, 6)).toEqual({ ids: ['chain:b'], stop: stopText({ reason: 'fork', ways: 2 }), more: false });
    expect(model.walk('e', 1, 6)).toEqual({ ids: ['g', 'h', 'portal:next'], stop: stopText({ reason: 'end' }), more: false });
    // Going back, the step from e is to where its edge comes from: the choice on that edge (x) is not a stop of its own.
    expect(model.walk('e', -1, 6)).toEqual({ ids: ['chain:b', 'a'], stop: stopText({ reason: 'start' }), more: false });
  });

  it('stops at the limit and says there is more', () => {
    expect(model.walk('e', 1, 2)).toEqual({ ids: ['g', 'h'], more: true });
    expect(model.walk('e', 1, 0)).toEqual({ ids: [], more: true });
  });

  it('a loop ends the walk instead of going round', () => {
    const loop = flowModel({ edges: [{ from: 'p', to: 'q' }, { from: 'q', to: 'p' }] });
    expect(loop.walk('p', 1, 10)).toEqual({ ids: ['q'], stop: '흐름이 돌아옵니다.', more: false });
  });

  it('reads the way in back to the last meeting point, nearest label last', () => {
    expect(model.wayInto('h')).toEqual({ labels: [{ text: '호감도 ≥ 3', choice: false }], merged: true });
    expect(model.wayInto('e')).toEqual({ labels: [{ text: '가자', choice: true }], merged: false });
    // A choice is its pane's first row: its own label is not repeated in the way.
    expect(model.wayInto('x')).toEqual({ labels: [], merged: false });
  });

  it('lists what a selection joins, without stand-ins for other sections', () => {
    expect(model.connections('c')).toEqual([
      { dir: 'in', id: 'a', choice: undefined },
      { dir: 'out', id: 'e', choice: '가자' },
      { dir: 'out', id: 'f', choice: '말자' },
    ]);
    expect(model.connections('h')).toEqual([{ dir: 'in', id: 'g', choice: '호감도 ≥ 3' }]);
  });
});

describe('stepping the translation card past a selection', () => {
  const isPortal = (id: string) => id.startsWith('portal:');

  it('passes through nodes without lines', () => {
    expect(nextWithLines(model, 'e', 1, { hasLines: (id) => id === 'h', isPortal })).toEqual({ target: 'h' });
    expect(nextWithLines(model, 'a', 1, { hasLines: (id) => id === 'c', isPortal })).toEqual({ target: 'chain:b' });
  });

  it('stays where the way forks or leaves the section', () => {
    expect(nextWithLines(model, 'chain:b', 1, { hasLines: () => true, isPortal })).toEqual({ blocked: { reason: 'fork', ways: 2 } });
    expect(nextWithLines(model, 'h', 1, { hasLines: () => true, isPortal })).toEqual({ blocked: 'portal' });
    expect(nextWithLines(model, 'g', -1, { hasLines: () => true, isPortal })).toEqual({ blocked: { reason: 'merge', ways: 2 } });
  });
});

describe('the ends of a reading route', () => {
  const chains = [{ id: 'chain:b', nodeIds: ['b', 'c', 'd'] }];
  const nodes = [{ id: 'b', total: 0 }, { id: 'c', total: 2 }, { id: 'd', total: 0 }];

  it('a folded run picked as an end is its first or last node with lines', () => {
    expect(resolveChainEndpoint('chain:b', 'start', chains, nodes)).toBe('c');
    expect(resolveChainEndpoint('chain:b', 'end', chains, [{ id: 'b', total: 1 }, { id: 'c', total: 2 }, { id: 'd', total: 0 }])).toBe('c');
  });

  it('a run without lines gives its own first or last node; a plain node is itself', () => {
    expect(resolveChainEndpoint('chain:b', 'start', chains, [])).toBe('b');
    expect(resolveChainEndpoint('chain:b', 'end', chains, [])).toBe('d');
    expect(resolveChainEndpoint('a', 'end', chains, nodes)).toBe('a');
    expect(resolveChainEndpoint('chain:gone', 'start', chains, nodes)).toBe('chain:gone');
  });

  it('marks the ends on what is drawn', () => {
    expect(endpointMarkers(model, { start: 'c', end: 'h' })).toEqual(new Map([['chain:b', ['start']], ['h', ['end']]]));
    expect(endpointMarkers(model, { start: 'b', end: 'd' })).toEqual(new Map([['chain:b', ['start', 'end']]]));
    expect(endpointMarkers(model, {})).toBeUndefined();
  });
});

describe('hidden scene links', () => {
  const boxes = [{ id: 's1', x: 0, y: 0, width: 100, height: 40 }, { id: 's2', x: 300, y: 200, width: 100, height: 40 }];

  it('are straight lines from the far side of one scene to the near side of the next', () => {
    expect(hiddenEdgeLines(boxes, [{ from: 's1', to: 's2' }], 'vertical')).toEqual([{ id: 'h0', from: 's1', to: 's2', points: [50, 40, 350, 200] }]);
    expect(hiddenEdgeLines(boxes, [{ from: 's1', to: 's2' }], 'horizontal')).toEqual([{ id: 'h0', from: 's1', to: 's2', points: [100, 20, 300, 220] }]);
  });

  it('leave out a link whose scene is not drawn, keeping the others\' ids', () => {
    expect(hiddenEdgeLines(boxes, [{ from: 's1', to: 'gone' }, { from: 's2', to: 's1' }], 'vertical').map((line) => line.id)).toEqual(['h1']);
  });
});
