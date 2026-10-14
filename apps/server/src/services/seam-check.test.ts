import { describe, expect, it } from 'vitest';
import { seamLines, seamNodes, seamSignature } from './seam-check.ts';
import { sliceRoute } from './route-slice.ts';

type N = { id: string; key: string; kind: string; unitIds: string[] };
const nodes = (...defs: [id: string, kind: string, ...lines: string[]][]): N[] => defs.map(([id, kind, ...unitIds]) => ({ id, key: id, kind, unitIds }));
const edge = (from: string, to: string) => ({ from, to, label: null });
const units = () => new Map(Array.from({ length: 20 }, (_, i) => [`u${i + 1}`, { seq: i + 1, source: `text u${i + 1}` }]));

/** start(u1) -> pick -> [a1(u3) -> a2(u4) | b1(u5) | c1(u7) -> c2(u8) -> c3(u9)] -> after(u10, u11, u12). */
function graph() {
  const n = nodes(['start', 'script', 'u1'], ['pick', 'condition'], ['a1', 'script', 'u3'], ['a2', 'script', 'u4'], ['b1', 'script', 'u5'], ['c1', 'script', 'u7'], ['c2', 'script', 'u8'], ['c3', 'script', 'u9'], ['after', 'script', 'u10', 'u11', 'u12']);
  const e = [edge('start', 'pick'), edge('pick', 'a1'), edge('pick', 'b1'), edge('pick', 'c1'), edge('a1', 'a2'), edge('a2', 'after'), edge('b1', 'after'), edge('c1', 'c2'), edge('c2', 'c3'), edge('c3', 'after')];
  return { n, e };
}
const route1 = {};
const route2 = { pick: 'b1' };
const route3 = { pick: 'c1' };

describe('seams', () => {
  it('route 1 has no seams, and no overview node is marked', () => {
    const { n, e } = graph();
    const slice = sliceRoute(n, e, units(), route1, []);
    expect(slice.seams).toEqual([]);
    expect(slice.overview.nodes.some((node) => node.seam)).toBe(false);
    expect(seamNodes(slice)).toEqual([]);
    expect(seamLines(slice, 'after')).toBeNull();
  });

  it('route 2 handing back into route 1 has one seam, at the place it comes back', () => {
    const { n, e } = graph();
    const slice = sliceRoute(n, e, units(), route2, [route1]);
    expect(slice.seams).toEqual([{ nodeId: 'after', from: 'b1' }]);
    expect(slice.overview.nodes.find((node) => node.id === 'after')).toMatchObject({ kind: 'anchor', seam: true });
    // The lines before the seam are the new route's, the lines after it the earlier route's.
    expect(seamLines(slice, 'after')).toEqual({ before: [{ from: 'b1', unitIds: ['u1', 'u5'] }], after: ['u10', 'u11'] });
    expect(seamLines(slice, 'start')).toBeNull();
  });

  it('route 3 counts routes 1 and 2 as earlier', () => {
    const { n, e } = graph();
    const slice = sliceRoute(n, e, units(), route3, [route1, route2]);
    expect(slice.seams).toEqual([{ nodeId: 'after', from: 'block:c1' }]);
    expect(seamLines(slice, 'after')!.before).toEqual([{ from: 'block:c1', unitIds: ['u8', 'u9'] }]);
  });

  it('a block only route 2 holds is where route 3 hands back once route 2 counts as earlier', () => {
    // pick -> [a1 -> end | b1 -> m -> end | c1 -> m]
    const n = nodes(['pick', 'condition'], ['a1', 'script', 'u1'], ['b1', 'script', 'u2'], ['m', 'script', 'u3'], ['c1', 'script', 'u4'], ['end', 'script', 'u5']);
    const e = [edge('pick', 'a1'), edge('pick', 'b1'), edge('pick', 'c1'), edge('a1', 'end'), edge('b1', 'm'), edge('m', 'end'), edge('c1', 'm')];
    const picks = { pick: 'c1' };
    // Against route 1 alone m is new, so the seam is further on, at the end.
    expect(sliceRoute(n, e, units(), picks, [{}]).seams).toEqual([{ nodeId: 'end', from: 'm' }]);
    expect(sliceRoute(n, e, units(), picks, [{}, { pick: 'b1' }]).seams).toEqual([{ nodeId: 'm', from: 'c1' }]);
  });

  it('parallel arms that each hand back are one entry each, into the same block', () => {
    // pick -> [a1 -> end | q1 -> fan (state, both ways at once) -> p1 / p2 -> end]
    const n = nodes(['pick', 'condition'], ['a1', 'script', 'u1'], ['q1', 'script', 'u2'], ['fan', 'state'], ['p1', 'script', 'u3'], ['p2', 'script', 'u4'], ['end', 'script', 'u5', 'u6']);
    const e = [edge('pick', 'a1'), edge('pick', 'q1'), edge('a1', 'end'), edge('q1', 'fan'), edge('fan', 'p1'), edge('fan', 'p2'), edge('p1', 'end'), edge('p2', 'end')];
    const slice = sliceRoute(n, e, units(), { pick: 'q1' }, [{}]);
    expect(slice.seams).toEqual([
      { nodeId: 'end', from: 'p1' },
      { nodeId: 'end', from: 'p2' },
    ]);
    expect(seamNodes(slice)).toEqual(['end']);
    const found = seamLines(slice, 'end')!;
    expect(found.before.map((entry) => [entry.from, entry.unitIds])).toEqual([['p1', ['u2', 'u3']], ['p2', ['u2', 'u4']]]);
    expect(found.after).toEqual(['u5', 'u6']);
  });

  it('a new arm that never comes back has no seam', () => {
    const n = nodes(['pick', 'condition'], ['a1', 'script', 'u1'], ['b1', 'script', 'u2'], ['b2', 'script', 'u3']);
    const e = [edge('pick', 'a1'), edge('pick', 'b1'), edge('b1', 'b2')];
    expect(sliceRoute(n, e, units(), { pick: 'b1' }, [{}]).seams).toEqual([]);
  });
});

describe('seamSignature', () => {
  it('changes with a translation, not with a repeat of the same line', () => {
    const base = new Map<string, string | null>([['u1', 'a'], ['u2', null]]);
    const sig = seamSignature(['u1', 'u2', 'u1'], base);
    expect(seamSignature(['u1', 'u2'], base)).toBe(sig);
    expect(seamSignature(['u1', 'u2'], new Map(base).set('u1', 'b'))).not.toBe(sig);
    expect(seamSignature(['u1', 'u2'], new Map(base).set('u2', 'x'))).not.toBe(sig);
  });
});
