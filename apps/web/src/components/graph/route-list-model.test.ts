import { describe, expect, it } from 'vitest';
import { buildItems, indexOfLine, nodeStarts, routeSequence, translatedIds, untranslatedFrom } from './route-list-model';
import type { Overview, OverviewNode } from './path-window';

const node = (id: string, unitIds: string[], extra: Partial<OverviewNode> = {}): OverviewNode => ({ id, kind: 'section', blockIds: [id], nodeIds: [id], unitIds, lanes: 0, choice: false, join: false, ...extra });
const path = (from: string, to: string) => ({ from, to, label: null, kind: 'path' as const });

describe('routeSequence', () => {
  it('reads the overview in reading order, each node\'s lines in order, parallel arms one after another', () => {
    const overview: Overview = {
      nodes: [node('hub', ['h1']), node('a', ['a1', 'a2']), node('b', ['b1']), node('join', ['j1'])],
      edges: [path('hub', 'a'), path('hub', 'b'), path('a', 'join'), path('b', 'join')],
    };
    expect(routeSequence(overview).map((line) => line.unitId)).toEqual(['h1', 'a1', 'a2', 'b1', 'j1']);
    expect(routeSequence(overview).map((line) => line.nodeId)).toEqual(['hub', 'a', 'a', 'b', 'join']);
  });
});

const lines = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((unitId, i) => ({ unitId, nodeId: i < 4 ? 'n1' : 'n2' }));
const base = { sequence: lines, round: 2, translated: (id: string) => id !== 'u6', earlier: () => true, open: new Set<string>(), expanded: new Set<string>(), seams: new Set<string>() };

describe('buildItems', () => {
  it('folds a run of translated earlier lines into one row and keeps untranslated lines', () => {
    const items = buildItems(base);
    expect(items.map((item) => item.kind)).toEqual(['fold', 'line']);
    expect(items[0]).toMatchObject({ kind: 'fold', unitIds: ['u1', 'u2', 'u3', 'u4', 'u5'], nodeIds: ['n1', 'n2'] });
  });
  it('folds nothing in round 1, and nothing that is not on an earlier route', () => {
    expect(buildItems({ ...base, round: 1 }).every((item) => item.kind === 'line')).toBe(true);
    expect(buildItems({ ...base, earlier: (id) => id === 'u3' }).every((item) => item.kind === 'line')).toBe(true);
  });
  it('keeps open lines (seam sides, the selection) out of folds and splits the run around them', () => {
    const items = buildItems({ ...base, open: new Set(['u3']) });
    expect(items.map((item) => item.kind === 'fold' ? `fold${item.unitIds.length}` : item.kind === 'line' ? item.unitId : item.kind)).toEqual(['fold2', 'u3', 'fold2', 'u6']);
  });
  it('shows an expanded run as lines, all of them', () => {
    const items = buildItems({ ...base, expanded: new Set(['u1', 'u2', 'u3', 'u4', 'u5']) });
    expect(items.map((item) => item.key)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    // Opening a run stays open even when the selection later splits it.
    expect(buildItems({ ...base, expanded: new Set(['u1', 'u2', 'u3', 'u4', 'u5']), open: new Set(['u3']) }).every((item) => item.kind === 'line')).toBe(true);
  });
  it('puts a seam divider before the first line of the seam node, with its two lines either side open', () => {
    const items = buildItems({ ...base, seams: new Set(['n2']), open: new Set(['u3', 'u4', 'u5', 'u6']) });
    expect(items.map((item) => (item.kind === 'fold' ? 'fold' : item.kind === 'seam' ? 'seam' : item.unitId))).toEqual(['fold', 'u3', 'u4', 'seam', 'u5', 'u6']);
  });
});

describe('nodeStarts and indexOfLine', () => {
  const items = buildItems({ ...base, seams: new Set(['n2']), open: new Set(['u3', 'u4', 'u5', 'u6']) });
  it('maps nodes to their first item; a seam node starts two lines before its divider', () => {
    expect([...nodeStarts(items)]).toEqual([['n1', 0], ['n2', 1]]);
  });
  it('finds the item showing a line, the fold when it is folded', () => {
    expect(indexOfLine(items, 'u1')).toBe(0);
    expect(indexOfLine(items, 'u5')).toBe(4);
    expect(indexOfLine(items, 'zz')).toBe(-1);
  });
});

describe('untranslatedFrom', () => {
  const done = new Set(['u1', 'u2', 'u4']);
  const has = (id: string) => done.has(id);
  it('goes to the next and previous untranslated line, and stops at the ends', () => {
    expect(untranslatedFrom(lines, has, 'u1', 1)).toBe('u3');
    expect(untranslatedFrom(lines, has, 'u3', 1)).toBe('u5');
    expect(untranslatedFrom(lines, has, 'u5', -1)).toBe('u3');
    expect(untranslatedFrom(lines, has, 'u6', 1)).toBeUndefined();
    expect(untranslatedFrom(lines, has, undefined, 1)).toBe('u3');
    expect(untranslatedFrom(lines, has, undefined, -1)).toBe('u6');
  });
});

describe('translatedIds', () => {
  it('reads one character per line of the blocks in order', () => {
    expect([...translatedIds([{ unitIds: ['a', 'b'] }, { unitIds: ['c'] }], '101')]).toEqual(['a', 'c']);
  });
});
