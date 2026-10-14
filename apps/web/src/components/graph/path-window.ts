/**
 * 길 따라 보기: which part of the slice's overview is drawn. The overview (services/route-slice.ts)
 * is too big to read at once on real data (Night Call 103 nodes, Orwell 169), so the page shows a
 * window around the current place (`at`): a few choices and joins ahead, one back, and the sections
 * between them. Everything here is plain data in, plain data out.
 */
export interface OverviewNode {
  id: string;
  kind: 'anchor' | 'section';
  /** The slice blocks it holds. */
  blockIds: string[];
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

/**
 * Edges that lead back to a node still on the way to them (a loop), found by one depth-first walk
 * from the starts. A top-to-bottom drawing cannot show them without looping around boxes, so the
 * graph draws the rest and the node they leave says where they go.
 */
export function splitBackEdges<T extends { from: string; to: string }>(ids: string[], edges: T[]): { forward: T[]; back: T[] } {
  const out = new Map<string, T[]>();
  const known = new Set(ids);
  const hasIn = new Set<string>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    hasIn.add(edge.to);
  }
  const state = new Map<string, 1 | 2>();
  const back = new Set<T>();
  for (const root of [...ids.filter((id) => !hasIn.has(id)), ...ids]) {
    if (state.has(root)) continue;
    state.set(root, 1);
    const stack = [{ id: root, next: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const ways = out.get(top.id) ?? [];
      if (top.next < ways.length) {
        const edge = ways[top.next++]!;
        const seen = state.get(edge.to);
        if (seen === 1) back.add(edge);
        else if (!seen) {
          state.set(edge.to, 1);
          stack.push({ id: edge.to, next: 0 });
        }
      } else {
        state.set(top.id, 2);
        stack.pop();
      }
    }
  }
  return { forward: edges.filter((edge) => !back.has(edge)), back: edges.filter((edge) => back.has(edge)) };
}

/** A run of overview nodes drawn as one muted node: all their lines are translated. */
export interface Fold {
  /** `fold:<first member>`. */
  id: string;
  members: string[];
}
export const foldId = (first: string) => `fold:${first}`;

/**
 * 번역한 구간 접기: consecutive foldable nodes (a plain run, one way in and one way out between them)
 * are replaced by one fold node, unless the run's first node is in `expanded`. Edges into the run
 * enter the fold and edges out of it leave it. Plain data in, plain data out.
 */
export function foldTranslated<E extends { from: string; to: string }>(ids: string[], edges: E[], foldable: (id: string) => boolean, expanded: ReadonlySet<string>): { ids: string[]; edges: E[]; folds: Fold[] } {
  const known = new Set(ids);
  const out = new Map<string, E[]>();
  const into = new Map<string, E[]>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    into.set(edge.to, [...(into.get(edge.to) ?? []), edge]);
  }
  const stepOf = (id: string) => {
    const ways = out.get(id) ?? [];
    const to = ways.length === 1 ? ways[0]!.to : undefined;
    return to && to !== id && foldable(id) && foldable(to) && (into.get(to)?.length ?? 0) === 1 ? to : undefined;
  };
  const hasBefore = new Set(ids.map(stepOf).filter((id): id is string => !!id));
  const folds: Fold[] = [];
  const foldOf = new Map<string, string>();
  for (const id of ids) {
    if (!foldable(id) || hasBefore.has(id) || foldOf.has(id) || expanded.has(id)) continue;
    const members = [id];
    for (let next = stepOf(id); next && !members.includes(next); next = stepOf(next)) members.push(next);
    const fold = { id: foldId(id), members };
    folds.push(fold);
    for (const member of members) foldOf.set(member, fold.id);
  }
  const seen = new Set<string>();
  const kept: E[] = [];
  for (const edge of edges) {
    const from = foldOf.get(edge.from) ?? edge.from, to = foldOf.get(edge.to) ?? edge.to;
    if (from === to && (from !== edge.from || to !== edge.to)) continue;
    const key = `${from}>${to}>${(edge as { label?: string | null }).label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(from === edge.from && to === edge.to ? edge : { ...edge, from, to });
  }
  return { ids: [...new Set(ids.map((id) => foldOf.get(id) ?? id))], edges: kept, folds };
}
