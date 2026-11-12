/**
 * What the dialogue graph page reads off a drawn layout, without React: how a selection maps to what is drawn
 * (a folded run is one block standing for its nodes; a choice sits on its edge), the lines a selection reads as
 * (its 흐름), the single way before and after it until the flow forks, merges or ends, and which node an end of a
 * reading route really is. The page asks; the canvas only draws.
 *
 * Ids are the drawn ones: a node's id, or "chain:<first node>" for a folded run. An edge with `via` stands for a
 * choice node that has no box of its own (the choice is the edge's label).
 */
export interface FlowEdge {
  from: string;
  to: string;
  /** The choice node this edge stands for. */
  via?: string | null;
  label?: string | null;
}
interface FlowChain {
  id: string;
  nodeIds: string[];
}
export interface FlowLayout {
  edges: readonly FlowEdge[];
  chains?: readonly FlowChain[];
}

/** Why the single way stops: several ways out, the last node, several ways in, the first node. */
type FlowStop = { reason: 'fork' | 'merge'; ways: number } | { reason: 'end' | 'start' };
type FlowStep = { target: string } | { stop: FlowStop };

/** A stop as the page says it. */
export function stopText(stop: FlowStop): string {
  if (stop.reason === 'fork') return `여기서 길이 ${stop.ways}갈래로 나뉩니다. 그래프에서 이어질 쪽을 고르세요.`;
  if (stop.reason === 'merge') return `여러 길(${stop.ways}갈래)이 이리로 모입니다. 그래프에서 앞 노드를 고르세요.`;
  return stop.reason === 'end' ? '이 흐름의 마지막 대사입니다.' : '이 흐름의 첫 대사입니다.';
}

interface FlowWalk {
  /** The selections along the way, nearest first. */
  ids: string[];
  /** Why it ended, when it did not just reach the limit. */
  stop?: string;
  /** The limit was reached: there is more the same way. */
  more: boolean;
}

interface FlowModel {
  /** The folded run each of its nodes is drawn in. */
  chainOf: ReadonlyMap<string, string>;
  /** What is drawn for a node: its folded run's block, else itself. */
  shown: (id: string) => string;
  /** The nodes a drawn id stands for: a folded run's, else itself. */
  membersOf: (id: string) => string[];
  /**
   * What the pane reads for a selection: a folded run's nodes (also for a node inside one, its own lines marked);
   * a choice followed by the lines it leads to, so picking a choice shows what happens after it; else the node.
   */
  flowOf: (id: string) => string[];
  /** Where a card for a node stands: its box (a folded run's block); a choice has no box, so by what it leads to. */
  anchorOf: (id: string) => string;
  /**
   * The way into a selection, nearest last: the labels (choices, conditions) on the single path back to the previous
   * meeting point. `merged`: lines arrive here from several ways.
   */
  wayInto: (id: string) => { labels: { text: string; choice: boolean }[]; merged: boolean };
  /** The selection one step along the flow, or why there is none. */
  neighbour: (from: string, direction: 1 | -1) => FlowStep;
  /** Node by node from a selection until the flow forks, merges, ends, comes back on itself, or `limit` is reached. */
  walk: (from: string, direction: 1 | -1, limit: number) => FlowWalk;
  /** The node on the other end of each way in and out of a selection, with the choice written on it (stand-ins for other sections left out). */
  connections: (id: string) => { dir: 'in' | 'out'; id: string; choice?: string }[];
}

const NO_EDGES: readonly FlowEdge[] = [];

export function flowModel(layout: FlowLayout | undefined | null): FlowModel {
  const edges = layout?.edges ?? NO_EDGES;
  const chains = layout?.chains ?? [];
  const chainOf = new Map(chains.flatMap((chain) => chain.nodeIds.map((id) => [id, chain.id] as const)));
  const byId = new Map(chains.map((chain) => [chain.id, chain.nodeIds]));
  const shown = (id: string) => chainOf.get(id) ?? id;
  const membersOf = (id: string) => byId.get(id) ?? [id];
  const viaEdge = (id: string) => edges.find((edge) => edge.via === id);

  const flowOf = (id: string) => {
    if (id.startsWith('chain:')) return membersOf(id);
    if (chainOf.has(id)) return membersOf(chainOf.get(id)!);
    const way = viaEdge(id);
    return way ? [id, ...membersOf(way.to)] : [id];
  };

  const neighbour = (from: string, direction: 1 | -1): FlowStep => {
    const via = viaEdge(from);
    if (direction === 1) {
      const out = edges.filter((edge) => edge.from === (via ? shown(via.to) : shown(from)));
      if (out.length !== 1) return { stop: out.length ? { reason: 'fork', ways: out.length } : { reason: 'end' } };
      return { target: out[0]!.via ?? out[0]!.to };
    }
    if (via) return { target: via.from };
    const into = edges.filter((edge) => edge.to === shown(from));
    if (into.length !== 1) return { stop: into.length ? { reason: 'merge', ways: into.length } : { reason: 'start' } };
    return { target: into[0]!.from };
  };

  return {
    chainOf,
    shown,
    membersOf,
    flowOf,
    anchorOf: (id) => shown(viaEdge(id)?.to ?? id),
    wayInto: (id) => {
      const via = viaEdge(id);
      // A choice is the pane's first row already; the way starts before it.
      const labels: { text: string; choice: boolean }[] = [];
      let at = via ? via.from : shown(id);
      for (let step = 0; step < 40 && labels.length < 3; step++) {
        const into = edges.filter((edge) => edge.to === at);
        if (into.length !== 1) return { labels: labels.reverse(), merged: into.length > 1 };
        if (into[0]!.label) labels.push({ text: into[0]!.label, choice: Boolean(into[0]!.via) });
        at = into[0]!.from;
      }
      return { labels: labels.reverse(), merged: false };
    },
    neighbour,
    walk: (from, direction, limit) => {
      const ids: string[] = [];
      const seen = new Set([from]);
      let at = from;
      while (true) {
        const step = neighbour(at, direction);
        if ('stop' in step) return { ids, stop: stopText(step.stop), more: false };
        if (seen.has(step.target)) return { ids, stop: '흐름이 돌아옵니다.', more: false };
        if (ids.length >= limit) return { ids, more: true };
        seen.add(step.target);
        ids.push(step.target);
        at = step.target;
      }
    },
    connections: (id) => {
      const here = shown(id);
      return edges.flatMap((edge) => [
        ...(edge.to === here && !edge.from.startsWith('portal:') ? [{ dir: 'in' as const, id: edge.from, choice: edge.label ?? undefined }] : []),
        ...(edge.from === here && !edge.to.startsWith('portal:') ? [{ dir: 'out' as const, id: edge.to, choice: edge.label ?? undefined }] : []),
      ]);
    },
  };
}

/**
 * The next selection along the flow that holds lines, for stepping the translation card past a selection's end:
 * nodes without lines (conditions) are passed through. `blocked`: the way stops (a fork, a merge, an end) or leaves
 * this section (`portal`).
 */
export function nextWithLines(model: FlowModel, from: string, direction: 1 | -1, { hasLines, isPortal, hops = 50 }: { hasLines: (nodeId: string) => boolean; isPortal: (id: string) => boolean; hops?: number }): { target: string } | { blocked: FlowStop | 'portal' } {
  let at = from;
  for (let hop = 0; hop < hops; hop++) {
    const found = model.neighbour(at, direction);
    if ('stop' in found) return { blocked: found.stop };
    if (isPortal(found.target)) return { blocked: 'portal' };
    at = found.target;
    if (model.flowOf(at).some(hasLines)) break;
  }
  return { target: at };
}

/**
 * The node an end of a reading route is, when a folded run was picked: a route runs between lines, so the run's
 * first node with lines for a start and its last for an end (the run's own first or last node when none has lines).
 */
export function resolveChainEndpoint(id: string, role: 'start' | 'end', chains?: readonly FlowChain[], nodes?: readonly { id: string; total?: number }[]): string {
  if (!id.startsWith('chain:') || !chains) return id;
  const chain = chains.find((item) => item.id === id);
  if (!chain || !chain.nodeIds.length) return id;
  const totals = new Map((nodes ?? []).map((node) => [node.id, node.total ?? 0] as const));
  const ordered = role === 'start' ? chain.nodeIds : [...chain.nodeIds].reverse();
  return ordered.find((nodeId) => (totals.get(nodeId) ?? 0) > 0) ?? ordered[0]!;
}

/** The real node ids behind drawn ids: a folded run's nodes; a stand-in for another section is none. */
export function realNodes(model: FlowModel, ids: Iterable<string>, isPortal: (id: string) => boolean): string[] {
  return [...new Set([...ids].flatMap((id) => (isPortal(id) ? [] : model.membersOf(id))))];
}

/** Which ends of a route to mark on what is drawn (a node inside a folded run is marked on its block). */
export function endpointMarkers(model: FlowModel, ends: { start?: string; end?: string }): Map<string, ('start' | 'end')[]> | undefined {
  const markers = new Map<string, ('start' | 'end')[]>();
  for (const role of ['start', 'end'] as const) {
    const id = ends[role];
    if (id) markers.set(model.shown(id), [...(markers.get(model.shown(id)) ?? []), role]);
  }
  return markers.size ? markers : undefined;
}

/** Scene links the simplification hides, as straight lines between the laid-out boxes (the far side of one to the near side of the next). */
export function hiddenEdgeLines(nodes: readonly { id: string; x: number; y: number; width: number; height: number }[], hidden: readonly { from: string; to: string }[], direction: 'vertical' | 'horizontal'): { id: string; from: string; to: string; points: number[] }[] {
  const box = new Map(nodes.map((node) => [node.id, node]));
  return hidden.flatMap((edge, i) => {
    const a = box.get(edge.from);
    const b = box.get(edge.to);
    if (!a || !b) return [];
    const points = direction === 'horizontal' ? [a.x + a.width, a.y + a.height / 2, b.x, b.y + b.height / 2] : [a.x + a.width / 2, a.y + a.height, b.x + b.width / 2, b.y];
    return [{ id: `h${i}`, from: edge.from, to: edge.to, points }];
  });
}
