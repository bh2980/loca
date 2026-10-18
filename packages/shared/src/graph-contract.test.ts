import { describe, expect, it } from 'vitest';
import { contractEdges, nodesBetween } from './graph-contract.ts';

const e = (from: string, to: string) => ({ from, to });

describe('contractEdges', () => {
  it('joins visible nodes across a chain of hidden ones', () => {
    expect(contractEdges([e('a', 'x'), e('x', 'y'), e('y', 'b')], new Set(['x', 'y']))).toEqual([{ ...e('a', 'b'), via: ['x', 'y'] }]);
  });
  it('keeps every branch behind a hidden condition, each with only its own path', () => {
    const edges = [e('a', 'c'), e('c', 'p'), e('p', 'b1'), e('c', 'q'), e('q', 'b2')];
    expect(contractEdges(edges, new Set(['c', 'p', 'q'])).sort((x, y) => x.to.localeCompare(y.to))).toEqual([
      { ...e('a', 'b1'), via: ['c', 'p'] },
      { ...e('a', 'b2'), via: ['c', 'q'] },
    ]);
  });
  it('adds nothing where a visible edge already joins the pair, or through visible nodes', () => {
    expect(contractEdges([e('a', 'x'), e('x', 'b'), e('a', 'b')], new Set(['x']))).toEqual([]);
    expect(contractEdges([e('a', 'b'), e('b', 'x'), e('x', 'c')], new Set(['x']))).toEqual([{ ...e('b', 'c'), via: ['x'] }]);
  });
  it('joins nodes far apart and survives cycles', () => {
    const chain = Array.from({ length: 40 }, (_, i) => e(i ? `h${i - 1}` : 'a', `h${i}`));
    expect(contractEdges([...chain, e('h39', 'b')], new Set(chain.map((edge) => edge.to))).map(({ from, to }) => [from, to])).toEqual([['a', 'b']]);
    expect(contractEdges([e('a', 'x'), e('x', 'y'), e('y', 'x'), e('y', 'b')], new Set(['x', 'y']))).toEqual([{ ...e('a', 'b'), via: ['x', 'y'] }]);
  });
});

describe('nodesBetween', () => {
  it('collects all branches from start to end and nothing past them', () => {
    const edges = [e('s', 'c'), e('c', 'l'), e('c', 'r'), e('l', 'm'), e('r', 'm'), e('m', 'end'), e('end', 'after'), e('c', 'dead')];
    expect([...nodesBetween(edges, ['s'], ['end'])].sort()).toEqual(['c', 'end', 'l', 'm', 'r', 's']);
  });
});
