import type { LayoutEdge, LayoutNode } from './graph-canvas';

/** A box for each line of an unfolded run (a line card's size on the canvas) and the room between two of them along the flow. */
export const UNFOLDED_LINE_SIZE = 76;
export const UNFOLDED_GAP = 48;
/** A graph (or view) with no more nodes than this opens its folded runs by itself: folding is for graphs too big to read. */
export const AUTO_OPEN_NODES = 40;

/**
 * What is selected must be something that is on the canvas. A folded run is drawn as one block (its id), an
 * open one as its lines; folding or opening a run moves a selection that stood on the other form to this
 * one, else the pane would read a node that is no longer drawn (and the old one would stay marked).
 * Opening: the block's selection goes to the line that holds `holder` (the line open in the card), else the first.
 */
export function nodeAfterToggle(run: { id: string; nodeIds: string[] }, opening: boolean, node: string | undefined, holder?: string) {
  if (!node) return node;
  if (opening) return node === run.id ? (holder && run.nodeIds.includes(holder) ? holder : run.nodeIds[0]) : node;
  return run.nodeIds.includes(node) ? run.id : node;
}

/** The same for several picked nodes: opening swaps the block for all its lines, folding swaps its lines for the block. */
export function pickedAfterToggle(run: { id: string; nodeIds: string[] }, opening: boolean, picked: ReadonlySet<string>) {
  const next = new Set<string>();
  for (const id of picked) {
    if (opening && id === run.id) for (const line of run.nodeIds) next.add(line);
    else next.add(!opening && run.nodeIds.includes(id) ? run.id : id);
  }
  return next;
}

export interface Unfoldable {
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  regions?: { label: string; x: number; y: number; width: number; height: number }[];
  looseEdges?: { id: string; from: string; to: string }[];
  chains?: { id: string; nodeIds: string[] }[];
}

/**
 * A folded run drawn as its lines again, without laying the graph out again: a run is a straight line
 * (one way in, one way out), so its block is replaced by one box per line along the flow, and
 * everything past the block's far edge moves on by the room they take, across the whole width. Nothing
 * overlaps, and no layout is computed (it would be a second or more on a large graph).
 * Edges into the block now end at its first line and edges out of it start at its last; the links
 * between the lines are drawn straight (they are the run's own edges).
 */
export function unfoldChains<T extends Unfoldable>(layout: T, open: ReadonlySet<string>, direction: 'vertical' | 'horizontal' = 'vertical'): T {
  const wanted = (layout.chains ?? []).filter((chain) => open.has(chain.id) && layout.nodes.some((node) => node.id === chain.id));
  if (!wanted.length) return layout;
  const vertical = direction === 'vertical';
  // Along the flow (y when vertical) and across it.
  const along = (node: { x: number; y: number }) => (vertical ? node.y : node.x);
  const first = new Map(layout.nodes.map((node) => [node.id, along(node)]));
  const ordered = [...wanted].sort((a, b) => (first.get(a.id) ?? 0) - (first.get(b.id) ?? 0));

  let nodes = layout.nodes.map((node) => ({ ...node }));
  let edges = layout.edges.map((edge) => ({ ...edge, points: [...edge.points], ...(edge.labelAt && { labelAt: [...edge.labelAt] as [number, number, number, number] }) }));
  let regions = layout.regions?.map((region) => ({ ...region }));
  let looseEdges = layout.looseEdges;
  let total = vertical ? layout.height : layout.width;
  const links: LayoutEdge[] = [];
  const unfolded = new Set<string>();

  for (const chain of ordered) {
    const block = nodes.find((node) => node.id === chain.id)!;
    const count = chain.nodeIds.length;
    const length = vertical ? block.height : block.width;
    // A line is as long along the flow as its box: its height going down, its width going across.
    const lineLength = vertical ? UNFOLDED_LINE_SIZE : block.width;
    const room = count * lineLength + (count - 1) * UNFOLDED_GAP;
    const step = lineLength + UNFOLDED_GAP;
    const grow = room - length;
    // What starts at or past the block's far edge moves on.
    const edge = along(block) + length - 0.5;
    const past = (value: number) => value >= edge;

    nodes = nodes.flatMap((node) => {
      if (node.id === chain.id) {
        return chain.nodeIds.map((id, index) => (vertical
          ? { id, x: block.x, y: block.y + index * step, width: block.width, height: UNFOLDED_LINE_SIZE }
          : { id, x: block.x + index * step, y: block.y + (block.height - UNFOLDED_LINE_SIZE) / 2, width: block.width, height: UNFOLDED_LINE_SIZE }));
      }
      return [vertical ? (past(node.y) ? { ...node, y: node.y + grow } : node) : past(node.x) ? { ...node, x: node.x + grow } : node];
    });
    edges = edges.map((item) => ({
      ...item,
      from: item.from === chain.id ? chain.nodeIds[count - 1] : item.from,
      to: item.to === chain.id ? chain.nodeIds[0] : item.to,
      points: item.points.map((value, index) => (index % 2 === (vertical ? 1 : 0) && past(value) ? value + grow : value)),
      ...(item.labelAt && { labelAt: (vertical ? (past(item.labelAt[1]) ? [item.labelAt[0], item.labelAt[1] + grow, item.labelAt[2], item.labelAt[3]] : item.labelAt) : (past(item.labelAt[0]) ? [item.labelAt[0] + grow, item.labelAt[1], item.labelAt[2], item.labelAt[3]] : item.labelAt)) as [number, number, number, number] }),
    }));
    regions = regions?.map((region) => {
      const start = vertical ? region.y : region.x;
      const size = vertical ? region.height : region.width;
      const next = past(start) ? { start: start + grow, size } : start + size > edge ? { start, size: size + grow } : { start, size };
      return vertical ? { ...region, y: next.start, height: next.size } : { ...region, x: next.start, width: next.size };
    });
    looseEdges = looseEdges?.map((item) => ({ ...item, from: item.from === chain.id ? chain.nodeIds[count - 1] : item.from, to: item.to === chain.id ? chain.nodeIds[0] : item.to }));
    total += grow;
    unfolded.add(chain.id);
    const placed = new Map(nodes.map((node) => [node.id, node]));
    chain.nodeIds.slice(0, -1).forEach((id, index) => {
      const from = placed.get(id)!;
      const to = placed.get(chain.nodeIds[index + 1])!;
      links.push({
        id: `link:${id}:${chain.nodeIds[index + 1]}`,
        from: id,
        to: chain.nodeIds[index + 1],
        points: vertical ? [from.x + from.width / 2, from.y + from.height, to.x + to.width / 2, to.y] : [from.x + from.width, from.y + from.height / 2, to.x, to.y + to.height / 2],
      });
    });
  }
  return {
    ...layout,
    ...(vertical ? { height: total } : { width: total }),
    nodes,
    edges: [...edges, ...links],
    ...(regions && { regions }),
    ...(looseEdges && { looseEdges }),
    chains: (layout.chains ?? []).filter((chain) => !unfolded.has(chain.id)),
  };
}
