import { describe, expect, it } from 'vitest';
import { UNFOLDED_GAP, UNFOLDED_LINE_SIZE, nodeAfterToggle, pickedAfterToggle, unfoldChains, type Unfoldable } from './unfold-chains';

const box = (id: string, x: number, y: number, width = 260, height = 76) => ({ id, x, y, width, height });

/** start → [a b c] (a folded run) → end, and a side node beside the run, with an edge running past it. */
function graph(): Unfoldable {
  return {
    width: 700,
    height: 600,
    nodes: [box('start', 0, 0), box('chain:a', 0, 188, 260, 84), box('end', 0, 384), box('side', 400, 188), box('below-side', 400, 384)],
    edges: [
      { id: 'e1', from: 'start', to: 'chain:a', points: [130, 76, 130, 188] },
      { id: 'e2', from: 'chain:a', to: 'end', points: [130, 272, 130, 384] },
      { id: 'e3', from: 'side', to: 'below-side', points: [530, 264, 530, 384] },
    ],
    regions: [{ label: 'all', x: -10, y: -10, width: 700, height: 500 }],
    chains: [{ id: 'chain:a', nodeIds: ['a', 'b', 'c'] }],
  };
}

describe('unfoldChains', () => {
  const room = 3 * UNFOLDED_LINE_SIZE + 2 * UNFOLDED_GAP;
  const grow = room - 84;

  it('leaves the graph alone when no run is open', () => {
    const layout = graph();
    expect(unfoldChains(layout, new Set())).toBe(layout);
    expect(unfoldChains(layout, new Set(['chain:other']))).toBe(layout);
  });

  it('replaces the block by one box per line, in order along the flow', () => {
    const out = unfoldChains(graph(), new Set(['chain:a']));
    expect(out.nodes.find((node) => node.id === 'chain:a')).toBeUndefined();
    const lines = ['a', 'b', 'c'].map((id) => out.nodes.find((node) => node.id === id)!);
    expect(lines.map((line) => line.y)).toEqual([188, 188 + 124, 188 + 248]);
    expect(lines.every((line) => line.x === 0 && line.width === 260 && line.height === UNFOLDED_LINE_SIZE)).toBe(true);
    expect(out.chains).toEqual([]);
  });

  it('moves everything past the block on by the room taken, and nothing before it', () => {
    const out = unfoldChains(graph(), new Set(['chain:a']));
    const y = (id: string) => out.nodes.find((node) => node.id === id)!.y;
    expect(y('start')).toBe(0);
    expect(y('side')).toBe(188);
    expect(y('end')).toBe(384 + grow);
    expect(y('below-side')).toBe(384 + grow);
    expect(out.height).toBe(600 + grow);
    expect(out.regions![0].height).toBe(500 + grow);
  });

  it('keeps the lines clear of each other and of what moved', () => {
    const out = unfoldChains(graph(), new Set(['chain:a']));
    const same = out.nodes.filter((node) => node.x === 0).sort((a, b) => a.y - b.y);
    for (let i = 1; i < same.length; i++) expect(same[i].y).toBeGreaterThanOrEqual(same[i - 1].y + same[i - 1].height);
  });

  it('ends the way in at the first line and starts the way out at the last, and draws the links between the lines', () => {
    const out = unfoldChains(graph(), new Set(['chain:a']));
    const edge = (id: string) => out.edges.find((item) => item.id === id)!;
    expect(edge('e1')).toMatchObject({ from: 'start', to: 'a', points: [130, 76, 130, 188] });
    expect(edge('e2')).toMatchObject({ from: 'c', to: 'end' });
    // Starts at the last line's bottom edge, ends at the end node's top.
    expect(edge('e2').points).toEqual([130, 188 + 248 + UNFOLDED_LINE_SIZE, 130, 384 + grow]);
    expect(out.edges.filter((item) => item.id.startsWith('link:')).map((item) => [item.from, item.to])).toEqual([['a', 'b'], ['b', 'c']]);
    // An edge beside the run only stretches.
    expect(edge('e3').points).toEqual([530, 264, 530, 384 + grow]);
  });

  it('opens several runs, each moving what lies past it', () => {
    const layout = graph();
    layout.nodes.push(box('chain:z', 0, 480, 260, 84));
    layout.edges.push({ id: 'e4', from: 'end', to: 'chain:z', points: [130, 460, 130, 480 + 0] });
    layout.chains!.push({ id: 'chain:z', nodeIds: ['z1', 'z2', 'z3'] });
    const out = unfoldChains(layout, new Set(['chain:a', 'chain:z']));
    const y = (id: string) => out.nodes.find((node) => node.id === id)!.y;
    expect(y('z1')).toBe(480 + grow);
    expect(y('z3')).toBe(480 + grow + 248);
    expect(out.height).toBe(600 + 2 * grow);
  });

  it('lays a horizontal run out left to right and moves what lies to its right', () => {
    const layout: Unfoldable = {
      width: 900,
      height: 200,
      nodes: [box('start', 0, 60), box('chain:a', 388, 56, 260, 84), box('end', 760, 60)],
      edges: [{ id: 'e1', from: 'chain:a', to: 'end', points: [648, 98, 760, 98] }],
      chains: [{ id: 'chain:a', nodeIds: ['a', 'b', 'c'] }],
    };
    const out = unfoldChains(layout, new Set(['chain:a']), 'horizontal');
    const x = (id: string) => out.nodes.find((node) => node.id === id)!.x;
    // Along the flow a line is as long as it is wide, 260, with the gap between.
    expect([x('a'), x('b'), x('c')]).toEqual([388, 388 + 260 + UNFOLDED_GAP, 388 + 2 * (260 + UNFOLDED_GAP)]);
    expect(x('start')).toBe(0);
    expect(x('end')).toBeGreaterThanOrEqual(x('c') + 260);
    expect(out.width).toBeGreaterThan(900);
  });
});

describe('selection across folding', () => {
  const run = { id: 'chain:a', nodeIds: ['a', 'b', 'c'] };

  it('moves a selected line of the run to its block when the run folds', () => {
    expect(nodeAfterToggle(run, false, 'a')).toBe('chain:a');
    expect(nodeAfterToggle(run, false, 'c')).toBe('chain:a');
  });

  it('moves the selected block to the line holding the open one, else the first, when the run opens', () => {
    expect(nodeAfterToggle(run, true, 'chain:a', 'b')).toBe('b');
    expect(nodeAfterToggle(run, true, 'chain:a')).toBe('a');
    expect(nodeAfterToggle(run, true, 'chain:a', 'elsewhere')).toBe('a');
  });

  it('leaves other selections and no selection alone', () => {
    expect(nodeAfterToggle(run, false, 'other')).toBe('other');
    expect(nodeAfterToggle(run, true, 'other')).toBe('other');
    expect(nodeAfterToggle(run, true, undefined)).toBeUndefined();
    // Folding does not touch a selection that is already the block, nor opening one that is already a line.
    expect(nodeAfterToggle(run, false, 'chain:a')).toBe('chain:a');
    expect(nodeAfterToggle(run, true, 'b')).toBe('b');
  });

  it('swaps picked nodes the same way', () => {
    expect([...pickedAfterToggle(run, false, new Set(['a', 'c', 'x']))].sort()).toEqual(['chain:a', 'x']);
    expect([...pickedAfterToggle(run, true, new Set(['chain:a', 'x']))].sort()).toEqual(['a', 'b', 'c', 'x']);
  });
});
