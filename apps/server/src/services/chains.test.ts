import { describe, expect, it } from 'vitest';
import { foldChains } from './chains.ts';

const box = (id: string) => ({ id, width: 10, height: 10 });
const edge = (from: string, to: string) => ({ id: `${from}>${to}`, from, to });

describe('fold chains', () => {
  it('folds straight runs within a scene and re-ends the edges around them', () => {
    // a → b → c → d (straight), d → e and d → f (a choice), f → g; x → y in another scene.
    const job = { nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'x', 'y'].map(box), edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e'), edge('d', 'f'), edge('f', 'g'), edge('g', 'x'), edge('x', 'y')] };
    const group = (id: string) => (id === 'x' || id === 'y' ? 'S2' : 'S1');
    const { job: folded, chains } = foldChains(job, group);
    expect(chains).toEqual([{ id: 'chain:a', nodeIds: ['a', 'b', 'c', 'd'] }]);
    expect(folded.nodes.map((node) => node.id).sort()).toEqual(['chain:a', 'e', 'f', 'g', 'x', 'y']);
    expect(folded.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['chain:a>e', 'chain:a>f', 'f>g', 'g>x', 'x>y']);
  });

  it('leaves short runs and portals alone', () => {
    const job = { nodes: ['a', 'b', 'portal:out:2'].map(box), edges: [edge('a', 'b'), edge('b', 'portal:out:2')] };
    expect(foldChains(job, () => 'S').chains).toEqual([]);
  });
});
