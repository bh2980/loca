import { describe, expect, it } from 'vitest';
import { sliceRoute } from './route-slice.ts';

type N = { id: string; key: string; kind: string; unitIds: string[] };
const nodes = (...defs: [id: string, kind: string, ...lines: string[]][]): N[] => defs.map(([id, kind, ...unitIds]) => ({ id, key: id, kind, unitIds }));
const edge = (from: string, to: string, label: string | null = null) => ({ from, to, label });
/** Units u1.. get seq by their number; the source is `text <id>` unless given. */
const unitMap = (sources: Record<string, string> = {}) => {
  const map = new Map<string, { seq: number; source: string }>();
  for (let i = 1; i <= 40; i++) map.set(`u${i}`, { seq: i, source: sources[`u${i}`] ?? `text u${i}` });
  return map;
};
const blockOfNode = (slice: ReturnType<typeof sliceRoute>, id: string) => slice.blocks.find((block) => block.nodeIds.includes(id));

/** start(u1) -> pick -> [A(u3,u4) | B(u5)] -> after(u6); the choice is a condition so it is exclusive. */
function choiceGraph(kind = 'condition', labels: [string | null, string | null] = [null, null], sources: Record<string, string> = {}) {
  return {
    nodes: nodes(['start', 'script', 'u1'], ['pick', kind], ['a1', 'script', 'u3'], ['a2', 'script', 'u4'], ['b1', 'script', 'u5'], ['after', 'script', 'u6']),
    edges: [edge('start', 'pick'), edge('pick', 'a1', labels[0]), edge('pick', 'b1', labels[1]), edge('a1', 'a2'), edge('a2', 'after'), edge('b1', 'after')],
    units: unitMap(sources),
  };
}

describe('sliceRoute', () => {
  it('a condition takes the first arm by script order; the other arm is a stub with name, lines and rejoin', () => {
    const g = choiceGraph('condition', ['Cut', 'Wait']);
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.forks).toHaveLength(1);
    expect(slice.forks[0]).toMatchObject({ nodeId: 'pick', mode: 'choice' });
    expect(slice.forks[0]!.arms).toEqual([
      { nodeId: 'a1', label: 'Cut', chosen: true, picked: false },
      { nodeId: 'b1', label: 'Wait', chosen: false, picked: false },
    ]);
    expect(slice.stubs).toEqual([{ id: 'stub:pick:b1', fork: 'pick', arm: 'b1', label: 'Wait', lines: 1, rejoins: ['after'] }]);
    expect(slice.joins).toEqual(['after']);
    expect(blockOfNode(slice, 'b1')).toBeUndefined();
    expect(slice.edges).toContainEqual({ from: 'pick', to: 'stub:pick:b1', label: 'Wait', kind: 'stub' });
    expect(slice.edges).toContainEqual({ from: 'stub:pick:b1', to: 'after', label: null, kind: 'rejoin' });
  });

  it('script order, not edge order, decides the default arm', () => {
    const g = choiceGraph('condition', ['Late', 'Early']);
    // Swap the lines: b1 now comes first in the script.
    g.nodes.find((n) => n.id === 'b1')!.unitIds = ['u2'];
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.stubs.map((stub) => stub.arm)).toEqual(['a1']);
    expect(slice.stubs[0]!.label).toBe('Late');
    expect(slice.stubs[0]!.lines).toBe(2);
  });

  it('a stub is named by its first line when the edge carries no label', () => {
    const g = choiceGraph('condition', [null, null], { u5: 'Go left now' });
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.stubs[0]!.label).toBe('Go left now');
    expect(slice.forks[0]!.arms[1]!.label).toBe('Go left now');
  });

  it('a long first line is cut to 60 characters with an ellipsis', () => {
    const g = choiceGraph('condition', [null, null], { u5: 'x'.repeat(100) });
    expect(sliceRoute(g.nodes, g.edges, g.units, {}).stubs[0]!.label).toBe(`${'x'.repeat(59)}…`);
  });

  it('a condition is exclusive even without labels, and a pick switches the arm', () => {
    const g = choiceGraph('condition');
    const slice = sliceRoute(g.nodes, g.edges, g.units, { pick: 'b1' });
    expect(slice.forks[0]).toMatchObject({ mode: 'choice' });
    expect(slice.forks[0]!.arms.map((arm) => [arm.nodeId, arm.chosen, arm.picked])).toEqual([['a1', false, false], ['b1', true, true]]);
    expect(slice.stubs).toHaveLength(1);
    expect(slice.stubs[0]).toMatchObject({ arm: 'a1', lines: 2, rejoins: ['after'] });
    expect(blockOfNode(slice, 'b1')).toBeDefined();
    expect(blockOfNode(slice, 'a1')).toBeUndefined();
    expect(slice.lines).toBe(3); // start, b1, after
  });

  it('a pick that is not a way out of the node is ignored', () => {
    const g = choiceGraph('condition');
    const slice = sliceRoute(g.nodes, g.edges, g.units, { pick: 'after' });
    expect(slice.stubs.map((stub) => stub.arm)).toEqual(['b1']);
    expect(slice.forks[0]!.arms.every((arm) => !arm.picked)).toBe(true);
  });

  it('numbering labels on a state fan out in parallel: all arms, no stubs, labels not used as names', () => {
    const g = {
      nodes: nodes(['hub', 'state'], ['s0', 'script', 'u1'], ['s1', 'script', 'u2'], ['s2', 'script', 'u3']),
      edges: [edge('hub', 's0', 'Sibling 0'), edge('hub', 's1', 'Sibling 1'), edge('hub', 's2', 'Sibling 2')],
      units: unitMap({ u2: 'Second sibling' }),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.stubs).toEqual([]);
    expect(slice.forks).toHaveLength(1);
    expect(slice.forks[0]!.mode).toBe('parallel');
    expect(slice.forks[0]!.arms.every((arm) => arm.chosen)).toBe(true);
    expect(slice.forks[0]!.arms.map((arm) => arm.label)).toEqual(['text u1', 'Second sibling', 'text u3']);
    expect(slice.lines).toBe(3);
    expect(slice.blocks.map((block) => block.id).sort()).toEqual(['hub', 's0', 's1', 's2']);
  });

  it('numbering labels on a script node do not make it exclusive', () => {
    const g = {
      nodes: nodes(['x', 'script', 'u1'], ['a', 'script', 'u2'], ['b', 'script', 'u3']),
      edges: [edge('x', 'a', 'Next 0'), edge('x', 'b', 'Next 1')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.forks[0]!.mode).toBe('parallel');
    expect(slice.stubs).toEqual([]);
    expect(slice.lines).toBe(3);
  });

  it('a script node whose ways all carry real names is exclusive', () => {
    const g = {
      nodes: nodes(['ask', 'script', 'u1'], ['lie', 'script', 'u2'], ['truth', 'script', 'u3'], ['end', 'script', 'u4']),
      edges: [edge('ask', 'lie', 'Lie'), edge('ask', 'truth', 'Truth'), edge('lie', 'end'), edge('truth', 'end')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.forks[0]).toMatchObject({ nodeId: 'ask', mode: 'choice' });
    expect(slice.stubs).toEqual([{ id: 'stub:ask:truth', fork: 'ask', arm: 'truth', label: 'Truth', lines: 1, rejoins: ['end'] }]);
  });

  it('a script node with one named and one unnamed way is parallel', () => {
    const g = {
      nodes: nodes(['ask', 'script', 'u1'], ['p', 'script', 'u2'], ['q', 'script', 'u3']),
      edges: [edge('ask', 'p', 'Lie'), edge('ask', 'q')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.forks[0]!.mode).toBe('parallel');
    expect(slice.stubs).toEqual([]);
  });

  it('a script node whose ways lead to choice nodes is exclusive', () => {
    const g = {
      nodes: nodes(['ask', 'script', 'u1'], ['o1', 'choice', 'u2'], ['o2', 'choice', 'u3'], ['r1', 'script', 'u4']),
      edges: [edge('ask', 'o1'), edge('ask', 'o2'), edge('o1', 'r1')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.forks[0]).toMatchObject({ nodeId: 'ask', mode: 'choice' });
    expect(slice.stubs).toEqual([expect.objectContaining({ arm: 'o2', lines: 1, rejoins: [] })]);
    expect(blockOfNode(slice, 'o1')).toBeDefined();
  });

  it('a choice node stays its own block and a straight run of script nodes folds', () => {
    const g = {
      nodes: nodes(['a', 'script', 'u1'], ['b', 'script', 'u2', 'u3'], ['c', 'script', 'u4'], ['opt', 'choice', 'u5'], ['d', 'script', 'u6'], ['e', 'script', 'u7']),
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'opt'), edge('opt', 'd'), edge('d', 'e')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.blocks.map((block) => block.id)).toEqual(['block:a', 'opt', 'block:d']);
    expect(slice.blocks[0]).toMatchObject({ kind: 'block', nodeIds: ['a', 'b', 'c'], unitIds: ['u1', 'u2', 'u3', 'u4'] });
    expect(slice.blocks[1]).toMatchObject({ kind: 'choice', nodeIds: ['opt'], unitIds: ['u5'] });
    expect(slice.blocks[2]!.unitIds).toEqual(['u6', 'u7']);
    expect(slice.edges.filter((e) => e.kind === 'path').map((e) => [e.from, e.to])).toEqual([['block:a', 'opt'], ['opt', 'block:d']]);
    expect(slice.joins).toEqual([]);
  });

  it('a node where a stub rejoins starts a new block', () => {
    const g = choiceGraph('condition');
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    // The empty fork stays its own block; a1+a2 fold; "after" is a rejoin point so it is not absorbed into a1+a2.
    expect(slice.blocks.map((block) => block.nodeIds.join('+')).sort()).toEqual(['a1+a2', 'after', 'pick', 'start']);
    expect(slice.blocks.find((block) => block.id === 'block:a1')!.unitIds).toEqual(['u3', 'u4']);
  });

  it('where two slice ways meet is its own block and a join', () => {
    const g = {
      nodes: nodes(['hub', 'state'], ['p', 'script', 'u1'], ['q', 'script', 'u2'], ['m', 'script', 'u3'], ['n', 'script', 'u4']),
      edges: [edge('hub', 'p'), edge('hub', 'q'), edge('p', 'm'), edge('q', 'm'), edge('m', 'n')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.joins).toEqual(['block:m']);
    expect(blockOfNode(slice, 'm')!.nodeIds).toEqual(['m', 'n']);
    expect(slice.blocks.map((block) => block.id)).toContain('hub'); // fans out to two drawn ways
  });

  it('an empty connector with one way in and out is hidden; its neighbours are linked by a path edge with the first label met', () => {
    const g = {
      nodes: nodes(['a', 'script', 'u1'], ['c1', 'connector'], ['c2', 'state'], ['b', 'script', 'u2'], ['opt', 'choice', 'u3']),
      edges: [edge('a', 'c1', 'first'), edge('c1', 'c2', 'second'), edge('c2', 'opt'), edge('opt', 'b')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    const ids = slice.blocks.flatMap((block) => block.nodeIds);
    expect(ids).not.toContain('c1');
    expect(ids).not.toContain('c2');
    expect(slice.edges).toContainEqual({ from: 'a', to: 'opt', label: 'first', kind: 'path' });
    // The hidden nodes are still in the slice's reach: the lines are all counted.
    expect(slice.lines).toBe(3);
  });

  it('an unlabelled hidden node passes on the label further along', () => {
    const g = {
      nodes: nodes(['a', 'script', 'u1'], ['c1', 'connector'], ['c2', 'connector'], ['opt', 'choice', 'u3']),
      edges: [edge('a', 'c1'), edge('c1', 'c2', 'later'), edge('c2', 'opt')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.edges.filter((e) => e.kind === 'path')).toEqual([{ from: 'a', to: 'opt', label: 'later', kind: 'path' }]);
  });

  it('an isolated empty node does not appear', () => {
    const g = { nodes: nodes(['a', 'script', 'u1'], ['lonely', 'state'], ['b', 'script', 'u2']), edges: [edge('a', 'b')], units: unitMap() };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.blocks.flatMap((block) => block.nodeIds)).not.toContain('lonely');
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0]!.id).toBe('block:a');
  });

  it('an empty node that fans out to two drawn ways appears', () => {
    const g = {
      nodes: nodes(['intro', 'script', 'u1'], ['fan', 'state'], ['p', 'script', 'u2'], ['q', 'script', 'u3']),
      edges: [edge('intro', 'fan'), edge('fan', 'p'), edge('fan', 'q')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    // The empty fork is its own block (the run before it stays a block without it) and both ways leave from it.
    expect(blockOfNode(slice, 'fan')).toMatchObject({ id: 'fan', nodeIds: ['fan'], unitIds: [] });
    expect(blockOfNode(slice, 'intro')).toMatchObject({ id: 'intro', unitIds: ['u1'] });
    expect(blockOfNode(slice, 'intro')!.nodeIds).not.toContain('fan');
    expect(slice.edges).toContainEqual({ from: 'intro', to: 'fan', label: null, kind: 'path' });
    expect(slice.edges.filter((e) => e.from === 'fan' && e.kind === 'path').map((e) => e.to).sort()).toEqual(['p', 'q']);
    expect(slice.forks[0]).toMatchObject({ nodeId: 'fan', mode: 'parallel' });
  });

  it('an empty node that fans out into only one drawn way is hidden', () => {
    const g = {
      nodes: nodes(['intro', 'script', 'u1'], ['fan', 'state'], ['p', 'script', 'u2'], ['dead1', 'connector'], ['dead2', 'connector']),
      edges: [edge('intro', 'fan'), edge('fan', 'p'), edge('fan', 'dead1'), edge('dead1', 'dead2')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.blocks.flatMap((block) => block.nodeIds)).toEqual(['intro', 'p']);
  });

  it('a stub that never comes back has rejoins []', () => {
    const g = {
      nodes: nodes(['pick', 'condition'], ['a', 'script', 'u1'], ['b1', 'script', 'u2'], ['b2', 'script', 'u3'], ['b3', 'script', 'u4']),
      edges: [edge('pick', 'a', 'Stay'), edge('pick', 'b1', 'Leave'), edge('b1', 'b2'), edge('b2', 'b3')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.stubs).toEqual([{ id: 'stub:pick:b1', fork: 'pick', arm: 'b1', label: 'Leave', lines: 3, rejoins: [] }]);
    expect(slice.edges.some((e) => e.kind === 'rejoin')).toBe(false);
    expect(slice.joins).toEqual([]);
  });

  it('a stub arm sharing nodes with the chosen way stops at the slice and counts only its own lines', () => {
    const g = choiceGraph('condition');
    const slice = sliceRoute(g.nodes, g.edges, g.units, { pick: 'b1' });
    // Arm a: a1 (1 line) + a2 (1 line), then back to "after".
    expect(slice.stubs[0]).toMatchObject({ lines: 2, rejoins: ['after'] });
  });

  it('counts lines in the slice and in the whole graph', () => {
    const g = choiceGraph('condition');
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.lines).toBe(4); // start, a1, a2, after
    expect(slice.totalLines).toBe(40); // every unit of the project, drawn or not
    expect(slice.lines).toBe(slice.blocks.reduce((sum, block) => sum + block.unitIds.length, 0));
    const picked = sliceRoute(g.nodes, g.edges, g.units, { pick: 'b1' });
    expect(picked.lines).toBe(3);
    expect(picked.totalLines).toBe(slice.totalLines);
  });

  it('survives a cycle and a graph with no starting node', () => {
    const g = {
      nodes: nodes(['a', 'script', 'u1'], ['b', 'script', 'u2']),
      edges: [edge('a', 'b'), edge('b', 'a')],
      units: unitMap(),
    };
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.lines).toBe(2);
  });

  it('an empty graph gives an empty slice', () => {
    expect(sliceRoute([], [], new Map(), {})).toEqual({ blocks: [], edges: [], forks: [], stubs: [], joins: [], lines: 0, totalLines: 0 });
  });
});
