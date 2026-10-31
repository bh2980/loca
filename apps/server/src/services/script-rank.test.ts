import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { byRank, scriptRanks } from './script-rank.ts';
import { foldChains } from './chains.ts';

const pair = (a: string, b: string) => [{ from: a, to: b }, { from: b, to: a }];

describe('scriptRanks', () => {
  it('ranks a node by its first line and a node without lines by the nearest node leading into it', () => {
    const ranks = scriptRanks(
      [{ id: 'a', seq: 3 }, { id: 'cond', seq: null }, { id: 'b', seq: 9 }, { id: 'wait', seq: null }],
      [{ from: 'a', to: 'cond' }, { from: 'cond', to: 'b' }, { from: 'cond', to: 'wait' }],
    );
    expect(ranks.get('a')).toBe(3);
    expect(ranks.get('b')).toBe(9);
    // After the line it follows and before the next line.
    expect(ranks.get('cond')!).toBeGreaterThan(3);
    expect(ranks.get('cond')!).toBeLessThan(4);
    expect(ranks.get('wait')!).toBeGreaterThan(ranks.get('cond')!);
  });

  it('falls back to the node it leads to when nothing leads into it', () => {
    const ranks = scriptRanks([{ id: 'start', seq: null }, { id: 'a', seq: 5 }], [{ from: 'start', to: 'a' }]);
    expect(ranks.get('start')!).toBeLessThan(5);
  });

  it('leaves an unconnected node without a rank', () => {
    expect(scriptRanks([{ id: 'x', seq: null }], []).has('x')).toBe(false);
  });
});

describe('byRank', () => {
  it('orders by rank and keeps the given order for equal ranks and for nodes without one', () => {
    const nodes = [{ id: 'late', rank: 9 }, { id: 'none1' }, { id: 'first', rank: 1 }, { id: 'tie1', rank: 5 }, { id: 'tie2', rank: 5 }, { id: 'none2' }, { id: 'portal-in', rank: -Infinity }];
    expect(byRank(nodes).map((node) => node.id)).toEqual(['portal-in', 'first', 'tie1', 'tie2', 'late', 'none1', 'none2']);
  });
});

describe('chains keep script rank', () => {
  it('ranks a folded run by its first member', () => {
    const nodes = ['a', 'b', 'c'].map((id, index) => ({ id, width: 10, height: 10, group: 'g', rank: index + 1 }));
    const edges = [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }];
    const { job } = foldChains({ nodes, edges }, () => 'g');
    expect(job.nodes).toEqual([expect.objectContaining({ id: 'chain:a', rank: 1 })]);
  });
});

/** What the intro looked like: every line leads to the next (NextText) and back (PreviousText). */
describe('a line list with a way back, given in script order', () => {
  const layer = async (order: string[]) => {
    const ids = ['l1', 'l2', 'l3', 'l4'];
    const edges = ids.slice(0, -1).flatMap((id, index) => pair(id, ids[index + 1]));
    const elk = new ELK();
    const result = await elk.layout({
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST' },
      children: order.map((id) => ({ id, width: 50, height: 20 })),
      edges: edges.map((edge, index) => ({ id: `e${index}`, sources: [edge.from], targets: [edge.to] })),
    });
    return Object.fromEntries(result.children!.map((child) => [child.id, child.y!]));
  };

  it('reads from the first line down, with the way back drawn upwards', async () => {
    const y = await layer(byRank([{ id: 'l3', rank: 3 }, { id: 'l1', rank: 1 }, { id: 'l4', rank: 4 }, { id: 'l2', rank: 2 }]).map((node) => node.id));
    expect(y.l1).toBeLessThan(y.l2);
    expect(y.l2).toBeLessThan(y.l3);
    expect(y.l3).toBeLessThan(y.l4);
  });
});
