import { describe, expect, it } from 'vitest';
import { viewEdges } from './layout.ts';

const node = (id: string, kind = 'script', unitIds = [id]) => ({ id, kind, unitIds });
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to });

describe('viewEdges', () => {
  it('joins chosen lines across a left-out condition and drops the condition from the drawing', () => {
    const nodes = [node('a'), node('c', 'condition', []), node('b')];
    expect(viewEdges(new Set(['a', 'b']), nodes, [edge('a', 'c'), edge('c', 'b')])).toEqual([{ id: 'bypass:a:b', from: 'a', to: 'b' }]);
  });
  it('keeps a left-out condition that also leads to lines outside the view', () => {
    const nodes = [node('a'), node('c', 'condition', []), node('b'), node('x')];
    const edges = viewEdges(new Set(['a', 'b']), nodes, [edge('a', 'c'), edge('c', 'b'), edge('c', 'x')]);
    expect(edges.map((e) => e.id)).toEqual(['a-c', 'c-b', 'c-x', 'bypass:a:b']);
  });
  it('changes nothing when no line-less node was left out', () => {
    const edges = [edge('a', 'b')];
    expect(viewEdges(new Set(['a', 'b']), [node('a'), node('b')], edges)).toBe(edges);
  });
});
