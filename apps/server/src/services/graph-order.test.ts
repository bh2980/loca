import { describe, expect, it } from 'vitest';
import { GraphOrder } from './graph-order.ts';

/**
 *        a(a1,a2)
 *        /      \
 *   b(b1)        c(c1)
 *        \      /
 *        d(d1,d2) ⇄ e(e1)      f(f1) (unreachable from the start, a cycle with g)
 *                              ⇅
 *                              g(g1)
 */
const graph = () =>
  new GraphOrder(
    [{ unitKeys: ['a1', 'a2'] }, { unitKeys: ['b1'] }, { unitKeys: ['c1'] }, { unitKeys: ['d1', 'd2'] }, { unitKeys: ['e1'] }, { unitKeys: ['f1'] }, { unitKeys: ['g1'] }],
    [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 4],
      [4, 3],
      [5, 6],
      [6, 5],
    ],
  );

describe('GraphOrder', () => {
  it('a point every route passes is definite; a point on one branch is route-dependent', () => {
    const order = graph();
    expect(order.passage('a1', 'd1')).toBe('definite');
    expect(order.passage('b1', 'd1')).toBe('maybe');
    expect(order.passage('c1', 'b1')).toBe('none');
    expect(order.passage('d1', 'a1')).toBe('none');
  });

  it('within one node, earlier lines are passed; later ones only when the node can come round again', () => {
    const order = graph();
    expect(order.passage('a1', 'a2')).toBe('definite');
    expect(order.passage('a2', 'a1')).toBe('none');
    // d → e → d loops, so d2 may have been passed before d1 on a second visit.
    expect(order.passage('d2', 'd1')).toBe('maybe');
    expect(order.passage('e1', 'd1')).toBe('maybe');
  });

  it('handles a cycle nothing leads into and lines outside the graph', () => {
    const order = graph();
    expect(order.passage('f1', 'g1')).toBe('definite');
    expect(order.passage('a1', 'zz')).toBe('unknown');
    // f and g share no edge with the rest (another chapter's graph): the graph cannot tell.
    expect(order.passage('a1', 'f1')).toBe('unknown');
  });

  it('orders two certainly passed points and follows reachability', () => {
    const order = graph();
    expect(order.later('d1', 'a2')).toBe(true);
    expect(order.later('a2', 'a1')).toBe(true);
    expect(order.leadsTo('b1', 'd2')).toBe(true);
    expect(order.leadsTo('b1', 'c1')).toBe(false);
  });

  it('copes with a long chain without deep recursion', () => {
    const n = 60_000;
    const order = new GraphOrder(
      Array.from({ length: n }, (_, index) => ({ unitKeys: [`u${index}`] })),
      Array.from({ length: n - 1 }, (_, index): [number, number] => [index, index + 1]),
    );
    expect(order.passage('u10', `u${n - 1}`)).toBe('definite');
  });
});
