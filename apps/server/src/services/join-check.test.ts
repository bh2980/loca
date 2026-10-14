import { describe, expect, it } from 'vitest';
import { joinLines, joinSignature } from './join-check.ts';
import { sliceRoute } from './route-slice.ts';

type N = { id: string; key: string; kind: string; unitIds: string[] };
const nodes = (...defs: [id: string, kind: string, ...lines: string[]][]): N[] => defs.map(([id, kind, ...unitIds]) => ({ id, key: id, kind, unitIds }));
const edge = (from: string, to: string) => ({ from, to, label: null });
const units = () => new Map(Array.from({ length: 20 }, (_, i) => [`u${i + 1}`, { seq: i + 1, source: `text u${i + 1}` }]));

/** start(u1) -> pick -> [a1(u3) -> a2(u4) | b1(u5) | c1(u7) -> c2(u8) -> c3(u9)] -> after(u10, u11, u12). */
function graph() {
  const n = nodes(['start', 'script', 'u1'], ['pick', 'condition'], ['a1', 'script', 'u3'], ['a2', 'script', 'u4'], ['b1', 'script', 'u5'], ['c1', 'script', 'u7'], ['c2', 'script', 'u8'], ['c3', 'script', 'u9'], ['after', 'script', 'u10', 'u11', 'u12']);
  const e = [edge('start', 'pick'), edge('pick', 'a1'), edge('pick', 'b1'), edge('pick', 'c1'), edge('a1', 'a2'), edge('a2', 'after'), edge('b1', 'after'), edge('c1', 'c2'), edge('c2', 'c3'), edge('c3', 'after')];
  return { n, e, slice: sliceRoute(n, e, units(), {}) };
}

describe('joinLines', () => {
  it('gives each incoming route its last two lines and the join its first two', () => {
    const { n, e, slice } = graph();
    expect(slice.joins).toEqual(['after']);
    const found = joinLines(slice, n, e, 'after')!;
    expect(found.routes.map((route) => [route.id, route.kind, route.label, route.unitIds])).toEqual([
      ['path:block:a1', 'path', null, ['u3', 'u4']],
      ['stub:pick:b1', 'stub', 'text u5', ['u5']],
      ['stub:pick:c1', 'stub', 'text u7', ['u8', 'u9']],
    ]);
    expect(found.after).toEqual(['u10', 'u11']);
  });

  it('is null for a block that is not a join', () => {
    const { n, e, slice } = graph();
    expect(joinLines(slice, n, e, 'start')).toBeNull();
    expect(joinLines(slice, n, e, 'nope')).toBeNull();
  });

  it('the chosen arm changes which route is the stub', () => {
    const { n, e } = graph();
    const slice = sliceRoute(n, e, units(), { pick: 'c1' });
    const found = joinLines(slice, n, e, 'after')!;
    expect(found.routes[0]!.unitIds).toEqual(['u8', 'u9']);
    expect(found.routes.filter((route) => route.kind === 'stub').map((route) => route.unitIds)).toEqual([['u3', 'u4'], ['u5']]);
  });
});

describe('joinSignature', () => {
  it('changes with a translation, not with a repeat of the same line', () => {
    const base = new Map<string, string | null>([['u1', 'a'], ['u2', null]]);
    const sig = joinSignature(['u1', 'u2', 'u1'], base);
    expect(joinSignature(['u1', 'u2'], base)).toBe(sig);
    expect(joinSignature(['u1', 'u2'], new Map(base).set('u1', 'b'))).not.toBe(sig);
    expect(joinSignature(['u1', 'u2'], new Map(base).set('u2', 'x'))).not.toBe(sig);
  });
});
