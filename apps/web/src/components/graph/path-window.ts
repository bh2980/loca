/**
 * 길 따라 보기: which part of the slice's overview is drawn. The overview (services/route-slice.ts)
 * is too big to read at once on real data (Night Call 103 nodes, Orwell 169), so the page shows a
 * window around the current place (`at`): a few choices and joins ahead, one back, and the sections
 * between them. Everything here is plain data in, plain data out.
 */
export interface OverviewNode {
  id: string;
  kind: 'anchor' | 'section';
  nodeIds: string[];
  unitIds: string[];
  lanes: number;
  choice: boolean;
  join: boolean;
}
export interface OverviewEdge {
  from: string;
  to: string;
  label: string | null;
  kind: 'path' | 'stub' | 'rejoin';
}
export interface Overview {
  nodes: OverviewNode[];
  edges: OverviewEdge[];
}

/** Choices and joins ahead of `at` that the window shows. */
export const AHEAD = 4;
/** …and behind it. */
export const BACK = 1;

/** A place where the way forks or comes together (what the next/previous buttons stop at). */
export const isStop = (node: OverviewNode) => node.kind === 'anchor' && (node.choice || node.join);

/** An edge that leaves the window: drawn to a small marker, which moves `at` to `target`. */
export interface Marker {
  id: string;
  target: string;
  direction: 'ahead' | 'behind';
}
export interface Windowed {
  /** Overview node ids and window markers drawn. */
  ids: string[];
  edges: OverviewEdge[];
  markers: Marker[];
}

/** One marker per drawn node and direction, however many ways leave it (a section can open dozens at once). */
export const markerId = (direction: Marker['direction'], drawn: string) => `more:${direction === 'ahead' ? 'a' : 'b'}:${drawn}`;

/** The first overview node when `at` is absent or no longer in the slice (one that is joined to nothing is passed over). */
export function resolveAt(overview: Overview, at: string | undefined) {
  const linked = new Set(overview.edges.filter((edge) => edge.kind === 'path').flatMap((edge) => [edge.from, edge.to]));
  return overview.nodes.find((node) => node.id === at)?.id ?? (overview.nodes.find((node) => linked.has(node.id)) ?? overview.nodes[0])?.id;
}

export function windowOf(overview: Overview, at: string | undefined, all: boolean): Windowed {
  const byId = new Map(overview.nodes.map((node) => [node.id, node] as const));
  const order = new Map(overview.nodes.map((node, i) => [node.id, i] as const));
  if (all) {
    return { ids: overview.nodes.map((node) => node.id), edges: overview.edges.filter((edge) => edge.kind === 'path'), markers: [] };
  }
  const start = resolveAt(overview, at);
  if (!start) return { ids: [], edges: [], markers: [] };
  const out = new Map<string, OverviewEdge[]>();
  const into = new Map<string, OverviewEdge[]>();
  for (const edge of overview.edges) {
    if (edge.kind !== 'path') continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    into.set(edge.to, [...(into.get(edge.to) ?? []), edge]);
  }
  const shown = new Set([start]);
  // Forward: choices and joins are counted; the sections between them (and after the last) come along.
  let ahead = 0;
  for (const queue = [start]; queue.length; ) {
    for (const edge of out.get(queue.shift()!) ?? []) {
      const node = byId.get(edge.to);
      if (!node || shown.has(node.id)) continue;
      if (isStop(node)) {
        if (ahead >= AHEAD) continue;
        ahead++;
      }
      shown.add(node.id);
      queue.push(node.id);
    }
  }
  // Backward: up to BACK stops, and the sections between; the walk ends at the stop.
  let back = 0;
  for (const queue = [start]; queue.length; ) {
    for (const edge of into.get(queue.shift()!) ?? []) {
      const node = byId.get(edge.from);
      if (!node || shown.has(node.id)) continue;
      if (isStop(node)) {
        if (back >= BACK) continue;
        back++;
        shown.add(node.id);
        continue;
      }
      shown.add(node.id);
      queue.push(node.id);
    }
  }
  const edges: OverviewEdge[] = [];
  const markers = new Map<string, Marker>();
  for (const edge of overview.edges) {
    // Other choices (stubs) and where they come back (rejoins) are not drawn: the path is one line.
    if (edge.kind !== 'path') continue;
    if (shown.has(edge.from) && shown.has(edge.to)) edges.push(edge);
    else if (shown.has(edge.from) && byId.has(edge.to)) {
      const id = markerId('ahead', edge.from);
      // The marker leads to the first of the ways in script order.
      if (!markers.has(id)) markers.set(id, { id, target: edge.to, direction: 'ahead' });
      else if (order.get(edge.to)! < order.get(markers.get(id)!.target)!) markers.get(id)!.target = edge.to;
      if (!edges.some((item) => item.to === id)) edges.push({ from: edge.from, to: id, label: null, kind: 'path' });
    } else if (shown.has(edge.to) && byId.has(edge.from)) {
      const id = markerId('behind', edge.to);
      if (!markers.has(id)) markers.set(id, { id, target: edge.from, direction: 'behind' });
      else if (order.get(edge.from)! < order.get(markers.get(id)!.target)!) markers.get(id)!.target = edge.from;
      if (!edges.some((item) => item.from === id)) edges.push({ from: id, to: edge.to, label: null, kind: 'path' });
    }
  }
  return { ids: [...shown, ...markers.keys()], edges, markers: [...markers.values()] };
}

/** Where the next/previous buttons go from `at`, and `at`'s place among the choices (갈림 i / a). */
export function stops(overview: Overview, at: string | undefined) {
  const index = overview.nodes.findIndex((node) => node.id === at);
  const before = overview.nodes.slice(0, Math.max(index, 0));
  const after = overview.nodes.slice(index + 1);
  const choices = overview.nodes.filter((node) => node.choice).length;
  const here = overview.nodes[index];
  const position = before.filter((node) => node.choice).length + (here?.choice ? 1 : 0);
  return {
    previous: before.findLast(isStop)?.id,
    next: after.find(isStop)?.id,
    position,
    choices,
  };
}
