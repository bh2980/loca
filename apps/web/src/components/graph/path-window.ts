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
  /** A seam enters an earlier route here (round 2 on). */
  seam?: boolean;
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

/** Choices, places a choice comes back and seams ahead of `at` that the window shows. */
export const AHEAD = 4;
/** …and behind it. */
export const BACK = 1;

/** A place where the way forks or comes together (what the next/previous buttons stop at). */
export const isStop = (node: OverviewNode) => node.kind === 'anchor' && (node.choice || node.join || !!node.seam);

/** An edge that leaves the window: drawn to a small marker, which moves `at` to `target`. */
export interface Marker {
  id: string;
  target: string;
  direction: 'ahead' | 'behind';
}
/**
 * An edge of the drawn window. `path` is a real connection of the graph; `reading` is NOT: it only
 * joins two neighbours in reading order (the next parallel arm after the previous one ended).
 */
export interface WindowEdge {
  from: string;
  to: string;
  label: string | null;
  kind: 'path' | 'reading';
  /** Real edge between nodes where ways fork or meet: a fold must not run across it. */
  branch?: boolean;
  /** Reading connector into the start of a parallel arm (`label` is that arm's option text). */
  arm?: boolean;
}
/** Which parallel arm a node starts: "동시에 열림 index/count". */
export interface Arm {
  index: number;
  count: number;
}
/** What opens at a node in a window: the arms the column numbers, and the targets that only loop back up. */
export interface Hub {
  arms: number;
  /** Direct targets that are not arms and lead back to the node. */
  loops: number;
  /** Direct targets that are not arms and do not lead back (reached through an arm). */
  behind: number;
}
export interface Windowed {
  /** Overview node ids and window markers drawn; in a window, in reading order (top to bottom). */
  ids: string[];
  edges: WindowEdge[];
  markers: Marker[];
  /** Window only: real edges that lead back to a node above (a loop); not drawn. */
  back?: OverviewEdge[];
  /** Window only: the start of every parallel arm. */
  arms?: Map<string, Arm>;
  /** Window only: per node, how many arms (the n of "i/n") and how many targets only loop back. */
  hubs?: Map<string, Hub>;
}

/** One marker per drawn node and direction, however many ways leave it (a section can open dozens at once). */
export const markerId = (direction: Marker['direction'], drawn: string) => `more:${direction === 'ahead' ? 'a' : 'b'}:${drawn}`;

/** The first overview node when `at` is absent or no longer in the slice (one that is joined to nothing is passed over). */
export function resolveAt(overview: Overview, at: string | undefined) {
  const linked = new Set(overview.edges.filter((edge) => edge.kind === 'path').flatMap((edge) => [edge.from, edge.to]));
  return overview.nodes.find((node) => node.id === at)?.id ?? (overview.nodes.find((node) => linked.has(node.id)) ?? overview.nodes[0])?.id;
}

/**
 * Where the map looks when the list is at `at`: a node joined to nothing (a lone first line the route
 * does not connect on) would draw a window of one box, so the map looks at the next node that is linked.
 */
export function mapPlace(overview: Overview, at: string | undefined) {
  const here = resolveAt(overview, at);
  const linked = new Set(overview.edges.filter((edge) => edge.kind === 'path').flatMap((edge) => [edge.from, edge.to]));
  if (!here || linked.has(here)) return here;
  const index = overview.nodes.findIndex((node) => node.id === here);
  return (overview.nodes.slice(index + 1).find((node) => linked.has(node.id)) ?? overview.nodes.find((node) => linked.has(node.id)))?.id ?? here;
}

export function windowOf(overview: Overview, at: string | undefined, all: boolean): Windowed {
  const byId = new Map(overview.nodes.map((node) => [node.id, node] as const));
  const order = new Map(overview.nodes.map((node, i) => [node.id, i] as const));
  // 전체 보기 reads the same single column as the window, over every node.
  if (all) return linearize(overview, new Set(overview.nodes.map((node) => node.id)), order);
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
  return linearize(overview, shown, order);
}

/**
 * One column in reading order: depth-first in script order, so a parallel arm is read to its end
 * before the next arm starts and the node where arms meet comes after the last arm. Only edges
 * between neighbours in that order are drawn; where the next node is the next arm (no real edge),
 * a `reading` connector says so. Entries from outside the window other than at the top, and all
 * ways leaving it, collapse into one marker at the top and one at the bottom.
 */
function linearize(overview: Overview, shown: Set<string>, order: Map<string, number>): Windowed {
  const byScript = (a: string, b: string) => order.get(a)! - order.get(b)!;
  const members = [...shown].sort(byScript);
  const real = overview.edges.filter((edge) => edge.kind === 'path' && shown.has(edge.from) && shown.has(edge.to));
  const { forward, back } = splitBackEdges(members, real);
  const out = new Map<string, OverviewEdge[]>();
  const hasIn = new Set<string>();
  const inCount = new Map<string, number>();
  for (const edge of forward) {
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    hasIn.add(edge.to);
    inCount.set(edge.to, (inCount.get(edge.to) ?? 0) + 1);
  }
  for (const list of out.values()) list.sort((a, b) => byScript(a.to, b.to));
  // Reverse post-order, visiting later ways first: the earlier way ends up read first, shared nodes after all of them.
  const post: string[] = [];
  const seen = new Set<string>();
  const visit = (root: string) => {
    seen.add(root);
    const stack = [{ id: root, ways: [...(out.get(root) ?? [])].reverse(), next: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const edge = top.ways[top.next++];
      if (edge) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          stack.push({ id: edge.to, ways: [...(out.get(edge.to) ?? [])].reverse(), next: 0 });
        }
      } else {
        post.push(top.id);
        stack.pop();
      }
    }
  };
  for (const id of members.filter((id) => !hasIn.has(id)).reverse()) if (!seen.has(id)) visit(id);
  for (const id of [...members].reverse()) if (!seen.has(id)) visit(id);
  const sequence = post.reverse();

  // Parallel arms: the ways out of one node that are not reached through another way out of it.
  const arms = new Map<string, Arm>();
  const armLabel = new Map<string, string | null>();
  const armHub = new Map<string, string>();
  const reach = (id: string) => {
    const found = new Set<string>();
    for (const stack = [id]; stack.length; ) for (const edge of out.get(stack.pop()!) ?? []) if (!found.has(edge.to)) (found.add(edge.to), stack.push(edge.to));
    return found;
  };
  for (const [hub, ways] of out) {
    const targets = [...new Set(ways.map((edge) => edge.to))];
    if (targets.length < 2) continue;
    const below = new Map(targets.map((to) => [to, reach(to)] as const));
    const starts = targets.filter((to) => !targets.some((other) => other !== to && below.get(other)!.has(to)));
    if (starts.length < 2) continue;
    starts.forEach((to, i) => {
      if (arms.has(to)) return;
      arms.set(to, { index: i + 1, count: starts.length });
      armHub.set(to, hub);
      armLabel.set(to, ways.find((edge) => edge.to === to && edge.from === hub)?.label ?? null);
    });
  }

  // Same count as the arm numbers. Direct targets that are not arms (reached through an arm, or back up) are said apart:
  // `loops` is those that lead back to this node, `behind` the rest.
  const hubs = new Map<string, Hub>();
  // Over the whole overview, so a target outside the window still counts as a loop when its way leads back.
  const nextAll = new Map<string, Set<string>>();
  for (const edge of overview.edges) if (edge.kind === 'path') nextAll.set(edge.from, (nextAll.get(edge.from) ?? new Set()).add(edge.to));
  const comesBack = (from: string, hub: string) => {
    const seenIds = new Set<string>();
    for (const stack = [from]; stack.length; ) {
      const id = stack.pop()!;
      if (id === hub) return true;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      stack.push(...(nextAll.get(id) ?? []));
    }
    return false;
  };
  for (const hub of shown) {
    const targets = nextAll.get(hub) ?? new Set<string>();
    if (targets.size < 2) continue;
    const starts = new Set([...arms].filter(([to]) => armHub.get(to) === hub).map(([to]) => to));
    const others = [...targets].filter((to) => !starts.has(to));
    const loops = others.filter((to) => comesBack(to, hub)).length;
    hubs.set(hub, { arms: starts.size, loops, behind: others.length - loops });
  }

  const edges: WindowEdge[] = [];
  const outCount = (id: string) => new Set((out.get(id) ?? []).map((edge) => edge.to)).size;
  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1]!, to = sequence[i]!;
    const edge = (out.get(from) ?? []).find((item) => item.to === to);
    if (edge) edges.push({ ...edge, kind: 'path', branch: outCount(from) > 1 || (inCount.get(to) ?? 0) > 1 });
    else edges.push({ from, to, label: armLabel.get(to) ?? null, kind: 'reading', arm: arms.has(to) });
  }

  const markers: Marker[] = [];
  const first = sequence[0], last = sequence[sequence.length - 1];
  const earliest = (ids: string[]) => ids.sort(byScript)[0];
  const known = new Set(overview.nodes.map((node) => node.id));
  const pathEdges = overview.edges.filter((edge) => edge.kind === 'path');
  const ids: string[] = [];
  if (first) {
    const source = earliest(pathEdges.filter((edge) => edge.to === first && !shown.has(edge.from) && known.has(edge.from)).map((edge) => edge.from));
    if (source) {
      const id = markerId('behind', first);
      markers.push({ id, target: source, direction: 'behind' });
      ids.push(id);
      edges.unshift({ from: id, to: first, label: null, kind: 'path' });
    }
  }
  ids.push(...sequence);
  if (last) {
    const leaving = pathEdges.filter((edge) => shown.has(edge.from) && !shown.has(edge.to) && known.has(edge.to));
    const target = earliest(leaving.map((edge) => edge.to));
    if (target) {
      const id = markerId('ahead', last);
      markers.push({ id, target, direction: 'ahead' });
      ids.push(id);
      edges.push({ from: last, to: id, label: null, kind: leaving.some((edge) => edge.from === last) ? 'path' : 'reading' });
    }
  }
  return { ids, edges, markers, back, arms, hubs };
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
    const edge = ways[0] as { kind?: string; branch?: boolean } | undefined;
    if (edge?.kind === 'reading' || edge?.branch) return undefined;
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

/**
 * Where each seam of the window is marked ("이음새" + check state): on the drawn edge into it when
 * there is one (`edge[i]`), otherwise on the seam node itself (`node`). Never both, never neither:
 * a seam whose entering edge is not between neighbours in the reading order has no drawn edge.
 */
export function placeSeams(input: {
  ids: string[];
  edges: { from: string; to: string }[];
  seams: { nodeId: string; from: string }[];
  /** Slice block id -> overview node id. */
  ovOf: Map<string, string>;
  isMarker: (id: string) => boolean;
  /** Overview nodes a fold stands for. */
  foldMembers: (id: string) => string[] | undefined;
}): { edge: boolean[]; node: Set<string> } {
  const origin = new Map<string, Set<string>>();
  for (const seam of input.seams) origin.set(seam.nodeId, (origin.get(seam.nodeId) ?? new Set()).add(input.ovOf.get(seam.from) ?? seam.from));
  const marked = new Set<string>();
  const edge = input.edges.map((item) => {
    const from = origin.get(item.to);
    if (!from || marked.has(item.to)) return false;
    if (!(from.has(item.from) || input.isMarker(item.from) || !!input.foldMembers(item.from)?.some((member) => from.has(member)))) return false;
    marked.add(item.to);
    return true;
  });
  const shown = new Set(input.ids);
  const node = new Set([...origin.keys()].filter((id) => shown.has(id) && !marked.has(id)));
  return { edge, node };
}

/**
 * Where the connections leaving `nodeId` lead back up the reading order (loops): not drawn, said in the pane.
 * Found over the whole overview, so the answer does not depend on the window.
 */
export function loopTargets(overview: Overview, nodeId: string): string[] {
  const all = windowOf(overview, undefined, true);
  return [...new Set((all.back ?? []).filter((edge) => edge.from === nodeId).map((edge) => edge.to))];
}
