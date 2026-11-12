import { describe, expect, it } from 'vitest';
import { graphSearch, isPickingRoute, isUnsavedRoute, pickingEnd, routeEnds, validateGraphSearch, viewIdOf, type GraphSearch } from './graph-search';

const base: GraphSearch = { scope: 'dialogue' };
const apply = (search: GraphSearch, ...changes: ((previous: GraphSearch) => GraphSearch)[]) => changes.reduce((value, change) => change(value), search);
/** Without the keys that are absent, as the URL would hold it. */
const shown = (search: GraphSearch) => JSON.parse(JSON.stringify(search)) as GraphSearch;

describe('reading the graph page URL', () => {
  it('opens the dialogue graph by default and drops what is not a value', () => {
    expect(shown(validateGraphSearch({}))).toEqual({ scope: 'dialogue' });
    expect(shown(validateGraphSearch({ scope: 'scene', direction: 'sideways', pickStep: 'middle', routeStart: '', open: ['a', 3], script: '1', jump: 'true', links: 'some' }))).toEqual({ scope: 'scene', open: ['a'], script: true, jump: true });
  });

  it('keeps an empty list of open runs apart from none given', () => {
    expect(validateGraphSearch({ open: [] }).open).toEqual([]);
    expect(validateGraphSearch({}).open).toBeUndefined();
  });

  it('reads a view from its section', () => {
    expect(viewIdOf('view:v1')).toBe('v1');
    expect(viewIdOf('1장')).toBeUndefined();
    expect(viewIdOf(undefined)).toBeUndefined();
  });
});

describe('a reading route in the URL', () => {
  it('새 경로 picks the start, then the end, and 경로 찾기 shows the route', () => {
    const picking = apply(base, graphSearch.newRoute());
    expect(isPickingRoute(picking)).toBe(true);
    expect(pickingEnd(picking)).toBe('start');

    const started = apply(picking, graphSearch.pick('start', 'a'));
    expect(pickingEnd(started)).toBe('end');
    expect(isUnsavedRoute(started)).toBe(false);

    // The end can be picked again until it suits.
    const ended = apply(started, graphSearch.pick('end', 'b'), graphSearch.pick('end', 'c'));
    expect(routeEnds(ended)).toEqual({ start: 'a', end: 'c' });
    expect(pickingEnd(ended)).toBe('end');

    const route = apply(ended, graphSearch.applyRoute());
    expect(shown(route)).toEqual({ scope: 'dialogue', routeStart: 'a', routeEnd: 'c' });
    expect(isUnsavedRoute(route)).toBe(true);
    expect(isPickingRoute(route)).toBe(false);
  });

  it('경로 찾기 without both ends changes nothing', () => {
    const half = apply(base, graphSearch.newRoute(), graphSearch.pick('start', 'a'));
    expect(apply(half, graphSearch.applyRoute())).toBe(half);
  });

  it('picking again from a shown route starts from its ends and keeps the route until applied', () => {
    const route: GraphSearch = { scope: 'dialogue', routeStart: 'a', routeEnd: 'b', edit: 'line1' };
    const again = apply(route, graphSearch.repick('end'));
    expect(shown(again)).toEqual({ scope: 'dialogue', routeStart: 'a', routeEnd: 'b', pickStart: 'a', pickEnd: 'b', pickStep: 'end' });
    expect(isUnsavedRoute(again)).toBe(false);
    expect(shown(apply(again, graphSearch.pick('end', 'c'), graphSearch.applyRoute()))).toEqual({ scope: 'dialogue', routeStart: 'a', routeEnd: 'c' });
  });

  it('경로 끝으로 shows the route when a start is there, else waits for the start', () => {
    expect(shown(apply({ scope: 'dialogue', pickStart: 'a', pickStep: 'end', node: 'n' }, graphSearch.endAt('b')))).toEqual({ scope: 'dialogue', routeStart: 'a', routeEnd: 'b' });
    const waiting = apply({ scope: 'scene' }, graphSearch.endAt('b'));
    expect(shown(waiting)).toEqual({ scope: 'dialogue', pickEnd: 'b', pickStep: 'start' });
    expect(pickingEnd(waiting)).toBe('start');
  });

  it('clearing, leaving the dialogue graph and saving all take the route out of the URL', () => {
    const route: GraphSearch = { scope: 'dialogue', routeStart: 'a', routeEnd: 'b', pickStart: 'a', pickStep: 'end', node: 'n', edit: 'l', script: true };
    expect(shown(apply(route, graphSearch.clearRoute()))).toEqual({ scope: 'dialogue', script: true });
    expect(shown(apply(route, graphSearch.mode('scene')))).toEqual({ scope: 'scene', node: 'n', edit: 'l' });
    expect(shown(apply(route, graphSearch.routeSaved('v1')))).toEqual({ scope: 'dialogue', section: 'view:v1', script: true, edit: 'l' });
  });
});

describe('the selection in the URL', () => {
  it('opening a node closes the line, the insert pane and the translation card', () => {
    expect(shown(apply({ scope: 'dialogue', edge: 'e', addAfter: 'x', edit: 'l', omitted: 'o' }, graphSearch.node('n')))).toEqual({ scope: 'dialogue', node: 'n' });
  });

  it('clearing the node keeps the omitted stretch that was open under it', () => {
    expect(shown(apply({ scope: 'dialogue', node: 'n', omitted: 'o' }, graphSearch.node(undefined)))).toEqual({ scope: 'dialogue', omitted: 'o' });
  });

  it('a line, an insert pane, an omitted stretch and the view details each take the pane', () => {
    const open: GraphSearch = { scope: 'dialogue', node: 'n', edit: 'l' };
    expect(shown(apply(open, graphSearch.edge('e')))).toEqual({ scope: 'dialogue', edge: 'e' });
    expect(shown(apply(open, graphSearch.addAfter('n')))).toEqual({ scope: 'dialogue', addAfter: 'n' });
    expect(shown(apply(open, graphSearch.omitted('o')))).toEqual({ scope: 'dialogue', omitted: 'o' });
    expect(shown(apply(open, graphSearch.viewInfo(true)))).toEqual({ scope: 'dialogue', viewInfo: true });
    // Closing one of them leaves the rest as it was.
    expect(shown(apply({ scope: 'dialogue', node: 'n', addAfter: 'x' }, graphSearch.addAfter(undefined)))).toEqual({ scope: 'dialogue', node: 'n' });
  });

  it('another section or view starts without the pane', () => {
    expect(shown(apply({ scope: 'dialogue', section: '1장', node: 'n', omitted: 'o', viewInfo: true, q: 'x' }, graphSearch.section('view:v')))).toEqual({ scope: 'dialogue', section: 'view:v', q: 'x' });
  });

  it('a route view picked again from its own menu keeps its script', () => {
    const script: GraphSearch = { scope: 'dialogue', section: 'view:v', script: true };
    expect(apply(script, graphSearch.sectionFromScript('view:v')).script).toBe(true);
    expect(apply(script, graphSearch.sectionFromScript('view:w')).script).toBeUndefined();
  });

  it('folding a run moves the selection only when there is one', () => {
    const moved = (node: string) => `${node}!`;
    expect(shown(apply({ scope: 'dialogue', node: 'n' }, graphSearch.open(['r'], moved)))).toEqual({ scope: 'dialogue', node: 'n!', open: ['r'] });
    expect(shown(apply(base, graphSearch.open([], moved)))).toEqual({ scope: 'dialogue', open: [] });
  });

  it('a portal to a scene opens the dialogue graph afresh there', () => {
    expect(apply({ scope: 'dialogue', section: 'view:v', node: 'n', q: 'x' }, graphSearch.sceneAlone('s1'))).toEqual({ scope: 'dialogue', scene: 's1' });
  });
});
