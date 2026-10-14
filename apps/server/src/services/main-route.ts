import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** One fork the main route went through: the arms there and the one it took. */
export interface RouteFork {
  /** The graph node where the ways part. */
  nodeId: string;
  /** The node the route goes on to. */
  chosen: string;
  /** Every way out, in script order: the node it leads to and what to call it (the edge's label, else its first line). */
  arms: { nodeId: string; label: string }[];
  /** A person picked this arm (routePicks); otherwise the rule below chose it. */
  picked: boolean;
}

export interface MainRoute {
  /** Graph nodes in play order. */
  nodeIds: string[];
  /** Their lines in play order (a line the route reaches twice is listed once, where it is first heard). */
  unitIds: string[];
  /** Per line: the fork the route took just before reaching it. */
  forkBefore: Map<string, RouteFork>;
  /** Lines where the route starts again at another starting point, having run out of ways forward. */
  restarts: Set<string>;
  /** Every graph edge the route takes, [from, to], in order (a restart or a return to a hub is not an edge). */
  steps: [string, string][];
}

type Edge = { to: string; label: string | null };

/**
 * The main route (본 줄기): one play through the dialogue graph, the reference path a translator
 * reads from start to end before taking the side branches one by one. Only edges in the graph are
 * followed; nothing is guessed.
 *
 * From the first starting point (a node nothing leads into, in script order) the route walks
 * forward, never into a node it has already passed. Where the ways part it takes the arm a person
 * picked there (`picks`), else the one that comes first in the script. When a way only leads back
 * to a node already passed (a hub's spoke returning to the hub, a scene that repeats), the route
 * goes on from that node with its next arm not yet taken, as a player goes back to a menu and picks
 * the next entry. The other arms of a choice stay side branches (곁가지). When nothing is left to
 * take, it starts again at the next starting point not yet passed.
 */
const cache = new Map<string, { key: string; route: MainRoute }>();

/** The project's main route with its stored picks; kept until the graph, the lines or the picks change. */
export function projectRoute(db: Db, projectId: string): MainRoute {
  const picks = db.select({ picks: s.projects.routePicks }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.picks ?? {};
  const counts = db.get<{ nodes: number; edges: number; units: number; changed: number | null }>(
    sql`select (select count(*) from ${s.graphNodes} where ${s.graphNodes.projectId} = ${projectId}) as nodes, (select count(*) from ${s.graphEdges} where ${s.graphEdges.projectId} = ${projectId}) as edges, (select count(*) from ${s.units} where ${s.units.projectId} = ${projectId}) as units, (select max(${s.graphLayouts.updatedAt}) from ${s.graphLayouts} where ${s.graphLayouts.projectId} = ${projectId}) as changed`,
  );
  const key = JSON.stringify([picks, counts]);
  const hit = cache.get(projectId);
  if (hit?.key === key) return hit.route;
  const route = mainRoute(db, projectId, picks);
  cache.set(projectId, { key, route });
  return route;
}

export function mainRoute(db: Db, projectId: string, picks: Record<string, string> = {}): MainRoute {
  const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const edges = db.select({ from: s.graphEdges.fromId, to: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const units = new Map(db.select({ id: s.units.id, seq: s.units.seq, source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit]));
  return walkRoute(nodes, edges, units, picks);
}

/** The route over plain data (tested directly). */
export function walkRoute(
  nodes: { id: string; key: string; unitIds: string[] }[],
  edges: { from: string; to: string; label: string | null }[],
  units: Map<string, { seq: number; source: string }>,
  picks: Record<string, string>,
): MainRoute {
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const out: Edge[][] = nodes.map(() => []);
  const indeg = new Array<number>(nodes.length).fill(0);
  for (const edge of edges) {
    const from = index.get(edge.from), to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    // One way per target: two edges to the same node are one arm (keep a label if any has one).
    const existing = out[from]!.find((way) => way.to === edge.to);
    if (existing) existing.label ??= edge.label;
    else {
      out[from]!.push({ to: edge.to, label: edge.label });
      indeg[to]!++;
    }
  }

  // A node's place in the script: its first line's seq; a node without lines takes the first line after it.
  const ownSeq = nodes.map((node) => Math.min(Infinity, ...node.unitIds.map((id) => units.get(id)?.seq ?? Infinity)));
  const leadSeq = ownSeq.slice();
  for (let i = 0; i < nodes.length; i++) {
    if (leadSeq[i] !== Infinity) continue;
    // Breadth-first to the nearest node with lines (control nodes are short runs).
    const seen = new Set([i]);
    let frontier = [i];
    let found = Infinity;
    for (let depth = 0; depth < 8 && frontier.length && found === Infinity; depth++) {
      const next: number[] = [];
      for (const n of frontier)
        for (const way of out[n]!) {
          const t = index.get(way.to)!;
          if (seen.has(t)) continue;
          seen.add(t);
          if (ownSeq[t] !== Infinity) found = Math.min(found, ownSeq[t]!);
          else next.push(t);
        }
      frontier = next;
    }
    leadSeq[i] = found;
  }

  const armLabel = (way: Edge) => {
    if (way.label?.trim()) return way.label.trim();
    const target = nodes[index.get(way.to)!]!;
    const first = target.unitIds.map((id) => units.get(id)?.source.trim()).find(Boolean);
    return first ? (first.length > 60 ? `${first.slice(0, 59)}…` : first) : target.key;
  };

  const passed = new Array<boolean>(nodes.length).fill(false);
  const route: MainRoute = { nodeIds: [], unitIds: [], forkBefore: new Map(), restarts: new Set(), steps: [] };
  const heard = new Set<string>();
  // The latest script position the route has read.
  let furthest = -Infinity;
  let pendingFork: RouteFork | undefined;
  let restarting = false;
  const visit = (n: number) => {
    passed[n] = true;
    route.nodeIds.push(nodes[n]!.id);
    for (const unitId of nodes[n]!.unitIds) {
      if (heard.has(unitId) || !units.has(unitId)) continue;
      heard.add(unitId);
      route.unitIds.push(unitId);
      furthest = Math.max(furthest, units.get(unitId)!.seq);
      // The fork and a fresh start belong to the first line reached after them.
      if (pendingFork) route.forkBefore.set(unitId, pendingFork);
      if (restarting) route.restarts.add(unitId);
      pendingFork = undefined;
      restarting = false;
    }
  };
  const bySeq = (a: number, b: number) => leadSeq[a]! - leadSeq[b]! || a - b;
  const starts = nodes.map((_, n) => n).filter((n) => indeg[n] === 0).sort(bySeq);
  // A graph that is one loop has no node nothing leads into: start where the script starts.
  if (!starts.length && nodes.length) starts.push(nodes.map((_, n) => n).sort(bySeq)[0]!);

  const position = new Array<number>(nodes.length).fill(-1);
  const openWays = (n: number) => out[n]!.filter((way) => !passed[index.get(way.to)!]);
  const choose = (n: number, open: Edge[], back: boolean) => {
    const picked = picks[nodes[n]!.id];
    const pick = picked ? open.find((way) => way.to === picked) : undefined;
    const next = pick ?? [...open].sort((a, b) => bySeq(index.get(a.to)!, index.get(b.to)!))[0]!;
    // Going on from a node passed before (back at a hub) is a fork too: its arms, the one taken now.
    if (out[n]!.length > 1 || back) {
      const arms = [...out[n]!].sort((a, b) => bySeq(index.get(a.to)!, index.get(b.to)!)).map((way) => ({ nodeId: way.to, label: armLabel(way) }));
      pendingFork = { nodeId: nodes[n]!.id, chosen: next.to, arms, picked: Boolean(pick) };
    }
    route.steps.push([nodes[n]!.id, next.to]);
    return index.get(next.to)!;
  };

  let current: number | undefined = starts.shift();
  while (current !== undefined) {
    if (!passed[current]) {
      position[current] = route.nodeIds.length;
      visit(current);
    }
    const open = openWays(current);
    if (open.length) {
      current = choose(current, open, false);
      continue;
    }
    // Every way leads where the route has been: go back to the latest of those places that still
    // has an arm not taken (the hub this spoke returns to), else the next starting point.
    const back = out[current]!
      .map((way) => index.get(way.to)!)
      .filter((t) => passed[t] && openWays(t).length)
      .sort((a, b) => position[b]! - position[a]!)[0];
    if (back !== undefined) {
      current = choose(back, openWays(back), true);
      continue;
    }
    // A join into lines already heard: the latest place on the route with an arm into script not yet
    // reached goes on (the story continues there); arms back into what was read stay side branches.
    let resume: number | undefined;
    for (let i = route.nodeIds.length - 1; i >= 0 && resume === undefined; i--) {
      const n = index.get(route.nodeIds[i]!)!;
      if (openWays(n).some((way) => leadSeq[index.get(way.to)!]! > furthest)) resume = n;
    }
    if (resume !== undefined) {
      current = choose(resume, openWays(resume).filter((way) => leadSeq[index.get(way.to)!]! > furthest), true);
      continue;
    }
    while (starts.length && passed[starts[0]!]!) starts.shift();
    current = starts.shift();
    if (current !== undefined && route.unitIds.length) restarting = true;
  }
  return route;
}
