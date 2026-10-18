import { describe, expect, it } from 'vitest';
import { contractEdges, nodesBetween } from './graph-contract.ts';

const e = (from: string, to: string) => ({ from, to });

describe('contractEdges', () => {
  it('joins visible nodes across a chain of hidden ones', () => {
    expect(contractEdges([e('a', 'x'), e('x', 'y'), e('y', 'b')], new Set(['x', 'y']))).toEqual([e('a', 'b')]);
  });
  it('keeps every branch behind a hidden condition', () => {
    const edges = [e('a', 'c'), e('c', 'b1'), e('c', 'b2')];
    expect(contractEdges(edges, new Set(['c']))).toEqual([e('a', 'b1'), e('a', 'b2')]);
  });
  it('adds nothing where a visible edge already joins the pair, or through visible nodes', () => {
    expect(contractEdges([e('a', 'x'), e('x', 'b'), e('a', 'b')], new Set(['x']))).toEqual([]);
    expect(contractEdges([e('a', 'b'), e('b', 'x'), e('x', 'c')], new Set(['x']))).toEqual([e('b', 'c')]);
  });
  it('stops at the depth limit and survives cycles', () => {
    expect(contractEdges([e('a', 'x'), e('x', 'y'), e('y', 'b')], new Set(['x', 'y']), 1)).toEqual([]);
    expect(contractEdges([e('a', 'x'), e('x', 'y'), e('y', 'x'), e('y', 'b')], new Set(['x', 'y']))).toEqual([e('a', 'b')]);
  });
});

describe('nodesBetween', () => {
  it('collects all branches from start to end and nothing past them', () => {
    const edges = [e('s', 'c'), e('c', 'l'), e('c', 'r'), e('l', 'm'), e('r', 'm'), e('m', 'end'), e('end', 'after'), e('c', 'dead')];
    expect([...nodesBetween(edges, ['s'], ['end'])].sort()).toEqual(['c', 'end', 'l', 'm', 'r', 's']);
  });
});
