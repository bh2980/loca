import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { sliceRoute } from './route-slice.ts';
import { projectSlice } from './project-slice.ts';

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

  it('an identifier label gives way to the arm\'s first line; readable labels stay', () => {
    const g = choiceGraph('condition', ['rules-whotaughtyou=0', 'Late'], { u3: 'Half-goblin. Thief. Ok.' });
    const slice = sliceRoute(g.nodes, g.edges, g.units, {});
    expect(slice.forks[0]!.arms.map((arm) => arm.label)).toEqual(['Half-goblin. Thief. Ok.', 'Late']);
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
    expect(sliceRoute([], [], new Map(), {})).toEqual({ blocks: [], edges: [], forks: [], stubs: [], seams: [], lines: 0, totalLines: 0, overview: { nodes: [], edges: [] } });
  });
});

describe('numbering labels across the export', () => {
  it('drops "Sibling N" when the export numbers most edges, and names a lineless arm by its node label', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const chain = nodes(...ids.map((id, i): [string, string, ...string[]] => [id, 'script', `u${i + 1}`]));
    const fork = { id: 'cond', key: 'Data/assets::1893', kind: 'condition', unitIds: [], label: 'If-Else Bakay killed' };
    const other = { id: 'alt', key: 'Data/assets::2000', kind: 'state', unitIds: [], label: 'IfElseState (Bakay alive)' };
    const edges = [...ids.slice(1).map((id, i) => edge(ids[i]!, id, `Sibling ${i % 2}`)), edge('n11', 'cond', 'Sibling 0'), edge('cond', 'alt', 'Sibling 1')];
    const slice = sliceRoute([...chain, fork, other], edges, unitMap(), {});
    expect(slice.edges.filter((e) => e.kind === 'path').every((e) => e.label === null)).toBe(true);
    expect(slice.forks).toEqual([]);
    // A condition with one way is no fork; give it a second, lineless arm to see the stub's name.
    const two = sliceRoute([...chain, fork, other, { id: 'end', key: 'k', kind: 'script', unitIds: ['u20'] }], [...edges, edge('cond', 'end', 'Sibling 2')], unitMap(), {});
    expect(two.stubs.map((stub) => stub.label)).toEqual(['IfElseState (Bakay alive)']);
  });
});

describe('overview', () => {
  it('puts a fork without lines before its own arms whatever the ids', () => {
    // 'pick' and 'hub' sort after their arms by id; their place in the script must still come first.
    const cond = sliceRoute(nodes(['start', 'script', 'u1'], ['pick', 'condition'], ['a1', 'script', 'u3'], ['a2', 'script', 'u4'], ['b1', 'script', 'u5'], ['after', 'script', 'u6']), [edge('start', 'pick'), edge('pick', 'a1'), edge('a1', 'a2'), edge('pick', 'b1'), edge('a2', 'after'), edge('b1', 'after')], unitMap(), {});
    expect(cond.overview.nodes.map((node) => node.id)).toEqual(['start', 'pick', 'section:block:a1', 'after']);
    const fan = sliceRoute(nodes(['s', 'script', 'u1'], ['hub', 'state'], ['a', 'script', 'u2'], ['b', 'script', 'u3'], ['c', 'script', 'u4']), [edge('s', 'hub'), edge('hub', 'a'), edge('hub', 'b'), edge('hub', 'c')], unitMap(), {});
    expect(fan.overview.nodes.find((node) => node.kind === 'section')!.id).toBe('section:hub');
  });

  const overviewOf = (g: { nodes: N[]; edges: ReturnType<typeof edge>[]; units: ReturnType<typeof unitMap> }, picks: Record<string, string> = {}) => sliceRoute(g.nodes, g.edges, g.units, picks).overview;
  const byId = (overview: ReturnType<typeof overviewOf>, id: string) => overview.nodes.find((node) => node.id === id);
  // A node without lines is placed by the first line after it, so it ties with that line's node; ties break
  // by id. These graphs name such nodes so that they sort first, which keeps the expected order readable.
  const choiceG = (...args: Parameters<typeof choiceGraph>) => {
    const g = JSON.parse(JSON.stringify({ ...choiceGraph(...args), units: null })) as ReturnType<typeof choiceGraph>;
    const rename = (id: string) => (id === 'pick' ? 'a0pick' : id);
    g.nodes.forEach((n) => (n.id = rename(n.id)));
    g.edges.forEach((e) => ((e.from = rename(e.from)), (e.to = rename(e.to))));
    return { ...g, units: unitMap(args[2]) };
  };

  it('the start, the choice and the place a stub comes back are anchors; the blocks between form one section', () => {
    const overview = overviewOf(choiceG('condition', ['Cut', 'Wait']));
    expect(overview.nodes.map((node) => [node.id, node.kind, node.choice, node.join])).toEqual([
      ['start', 'anchor', false, false],
      ['a0pick', 'anchor', true, false],
      ['section:block:a1', 'section', false, false],
      ['after', 'anchor', false, true],
    ]);
    expect(byId(overview, 'section:block:a1')).toMatchObject({ blockIds: ['block:a1'], nodeIds: ['a1', 'a2'], unitIds: ['u3', 'u4'], lanes: 0 });
  });

  it('a section holds several blocks with node and line ids in script order', () => {
    // intro -> fan (state) -> p | q -> m -> n: the fan-out and its meeting lie in one section.
    const g = {
      nodes: nodes(['intro', 'script', 'u1'], ['fan', 'state'], ['q', 'script', 'u3'], ['p', 'script', 'u2'], ['m', 'script', 'u4'], ['n', 'script', 'u5']),
      edges: [edge('intro', 'fan'), edge('fan', 'q'), edge('fan', 'p'), edge('p', 'm'), edge('q', 'm'), edge('m', 'n')],
      units: unitMap(),
    };
    const overview = overviewOf(g);
    expect(overview.nodes.map((node) => [node.id, node.kind])).toEqual([['intro', 'anchor'], ['section:fan', 'section']]);
    const section = byId(overview, 'section:fan')!;
    expect(section.blockIds).toEqual(['fan', 'p', 'q', 'block:m']);
    expect(section.nodeIds).toEqual(['fan', 'p', 'q', 'm', 'n']);
    expect(section.unitIds).toEqual(['u2', 'u3', 'u4', 'u5']);
    expect(section.lanes).toBe(2);
  });

  it('lanes counts the ways a parallel fork opens (3 here) and is 0 for a straight section', () => {
    const g = {
      nodes: nodes(['s', 'script', 'u1'], ['hub', 'state'], ['p1', 'script', 'u2'], ['p2', 'script', 'u3'], ['p3', 'script', 'u4']),
      edges: [edge('s', 'hub'), edge('hub', 'p1'), edge('hub', 'p2'), edge('hub', 'p3')],
      units: unitMap(),
    };
    expect(byId(overviewOf(g), 'section:hub')!.lanes).toBe(3);
    const straight = overviewOf(choiceG());
    expect(straight.nodes.filter((node) => node.kind === 'section').map((node) => node.lanes)).toEqual([0]);
  });

  it('two sections separated by a choice anchor are not merged', () => {
    // s -> c1 -> x -> c2 -> y | z ; c1 also leads to w (a stub).
    const g = {
      nodes: nodes(['s', 'script', 'u1'], ['c1', 'condition'], ['x', 'script', 'u2'], ['c2', 'condition'], ['y', 'script', 'u3'], ['z', 'script', 'u4'], ['w', 'script', 'u5']),
      edges: [edge('s', 'c1'), edge('c1', 'x'), edge('c1', 'w'), edge('x', 'c2'), edge('c2', 'y'), edge('c2', 'z')],
      units: unitMap(),
    };
    const overview = overviewOf(g);
    expect(overview.nodes.map((node) => [node.id, node.kind, node.choice])).toEqual([
      ['s', 'anchor', false],
      ['c1', 'anchor', true],
      ['section:x', 'section', false],
      ['c2', 'anchor', true],
      ['section:y', 'section', false],
    ]);
    expect(byId(overview, 'section:x')!.nodeIds).toEqual(['x']);
    expect(byId(overview, 'section:y')!.nodeIds).toEqual(['y']);
    const paths = overview.edges.filter((e) => e.kind === 'path').map((e) => [e.from, e.to]);
    expect(paths).toEqual([['s', 'c1'], ['c1', 'section:x'], ['section:x', 'c2'], ['c2', 'section:y']]);
  });

  it('edges: paths between overview nodes, stubs leave the choice anchor, rejoins reach the join anchor, no self-loops or duplicates', () => {
    const overview = overviewOf(choiceG('condition', ['Cut', 'Wait']));
    expect(overview.edges).toEqual([
      { from: 'start', to: 'a0pick', label: null, kind: 'path' },
      { from: 'a0pick', to: 'section:block:a1', label: 'Cut', kind: 'path' },
      { from: 'section:block:a1', to: 'after', label: null, kind: 'path' },
      { from: 'a0pick', to: 'stub:a0pick:b1', label: 'Wait', kind: 'stub' },
      { from: 'stub:a0pick:b1', to: 'after', label: null, kind: 'rejoin' },
    ]);
    const keys = overview.edges.map((e) => `${e.from}|${e.to}|${e.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(overview.edges.every((e) => e.from !== e.to)).toBe(true);
    const ids = new Set(overview.nodes.map((node) => node.id));
    for (const e of overview.edges.filter((x) => x.kind === 'path')) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });

  it('a path from a choice anchor into a section that starts with an option is labelled with the option text', () => {
    const g = (text: string) => ({
      nodes: nodes(['ask', 'script', 'u1'], ['o1', 'choice', 'u2'], ['o2', 'choice', 'u3'], ['r1', 'script', 'u4']),
      edges: [edge('ask', 'o1'), edge('ask', 'o2'), edge('o1', 'r1')],
      units: unitMap({ u2: text }),
    });
    const short = overviewOf(g('Open the hatch'));
    expect(byId(short, 'section:o1')!.blockIds).toEqual(['o1', 'r1']);
    expect(short.edges).toContainEqual({ from: 'ask', to: 'section:o1', label: 'Open the hatch', kind: 'path' });
    const exact = overviewOf(g('y'.repeat(60)));
    expect(exact.edges.find((e) => e.to === 'section:o1')!.label).toBe('y'.repeat(60));
    const long = overviewOf(g('x'.repeat(100)));
    expect(long.edges.find((e) => e.to === 'section:o1')!.label).toBe(`${'x'.repeat(59)}…`);
  });

  it('nodes come in script order, whatever order the graph lists them in', () => {
    const g = choiceG();
    g.nodes.reverse();
    const overview = overviewOf(g);
    expect(overview.nodes.map((node) => node.id)).toEqual(['start', 'a0pick', 'section:block:a1', 'after']);
  });

  it('relay-station: the choice anchor, one join anchor, and every slice block in exactly one overview node', () => {
    const db = openDatabase(':memory:');
    const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
    const { projectId } = importProject(db, file);
    const choiceNode = db.select().from(s.graphNodes).where(eq(s.graphNodes.key, 'c.choice')).get()!.id;
    const slice = projectSlice(db, projectId);
    const { overview } = slice;
    const choiceBlock = slice.blocks.find((block) => block.nodeIds.includes(choiceNode))!;
    expect(overview.nodes.find((node) => node.id === choiceBlock.id)).toMatchObject({ kind: 'anchor', choice: true });
    expect(overview.nodes.filter((node) => node.choice)).toHaveLength(1);
    expect(overview.nodes.filter((node) => node.join)).toHaveLength(1);
    const covered = overview.nodes.flatMap((node) => node.blockIds).sort();
    expect(covered).toEqual(slice.blocks.map((block) => block.id).sort());
  });
});
