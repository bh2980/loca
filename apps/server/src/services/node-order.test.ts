import { describe, expect, it } from 'vitest';
import { nodeOrder } from './node-order.ts';

const node = (id: string, ...unitIds: string[]) => ({ id, unitIds });
const edge = (from: string, to: string) => ({ from, to });
const units = new Map(Array.from({ length: 9 }, (_, i) => [`u${i + 1}`, { seq: i + 1 }] as const));
const sorted = (nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) => nodes.map((item) => item.id).sort(nodeOrder(nodes, edges, units));

describe('nodeOrder', () => {
  it('orders nodes by their first line, whatever order the graph lists them in', () => {
    expect(sorted([node('z', 'u1'), node('a', 'u5', 'u2'), node('m', 'u3')], [])).toEqual(['z', 'a', 'm']);
  });

  it('puts a fork without lines before its own arms whatever the ids', () => {
    // 'pick' sorts after its arms by id; its place in the script must still come first.
    const nodes = [node('start', 'u1'), node('pick'), node('a1', 'u3'), node('b1', 'u5'), node('after', 'u6')];
    const edges = [edge('start', 'pick'), edge('pick', 'a1'), edge('pick', 'b1'), edge('a1', 'after'), edge('b1', 'after')];
    expect(sorted(nodes, edges)).toEqual(['start', 'pick', 'a1', 'b1', 'after']);
  });

  it('a lineless node further from the next line comes earlier', () => {
    const nodes = [node('line', 'u4'), node('near'), node('far')];
    expect(sorted(nodes, [edge('far', 'near'), edge('near', 'line')])).toEqual(['far', 'near', 'line']);
  });

  it('nodes no line follows come last, by id; an edge to an unknown node is ignored', () => {
    const nodes = [node('loose2'), node('loose1'), node('line', 'u2')];
    expect(sorted(nodes, [edge('loose1', 'nowhere'), edge('loose2', 'loose2')])).toEqual(['line', 'loose1', 'loose2']);
  });
});
