import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { routeGraph, walkRoute, type RouteGraph } from './route-slice.ts';

/**
 * 다음 길 (docs/DESIGN.md J2c): translate a branching dialogue graph route by route. After a route
 * is translated, the next one is the route that passes through the most lines still untranslated, so
 * it overlaps the earlier routes as little as possible. No AI is involved: only graph edges and which
 * lines already have a translation are read.
 *
 * Search: a local search over the exclusive forks. In script order, each fork tries every other arm
 * (and, for the lines it newly reaches, the best arm of the forks that appear with it), and takes
 * the arm that reaches the most untranslated lines. Passes repeat until nothing changes (at most
 * MAX_PASSES). A change is taken only when strictly better, so the result is never worse than the
 * picks it starts from, and ties keep the current arm, else the first in script order.
 */
const MAX_PASSES = 4;
/** Routes a remaining-routes estimate looks ahead. */
export const REMAINING_CAP = 20;

type Picks = Record<string, string>;

export interface NextRouteResult {
  picks: Picks;
  /** Untranslated lines on the route the picks give. */
  lines: number;
}

/** Untranslated lines per graph node: the weight a route earns by passing through it. */
export type Weights = Map<string, number>;

export function untranslatedWeights(nodes: { id: string; unitIds: string[] }[], translated: (unitId: string) => boolean): Weights {
  return new Map(nodes.map((node) => [node.id, node.unitIds.filter((id) => !translated(id)).length]));
}

/**
 * The graph as integers, so a walk is a few array reads: the search walks the graph hundreds of
 * times on a real script (9천 줄 샘플: 9천 노드).
 */
interface Compiled {
  ids: string[];
  index: Map<string, number>;
  outs: number[][];
  /** Exclusive forks, with their ways in script order (the first is the way taken without a pick). */
  ways: (number[] | null)[];
  starts: number[];
}
const compiled = new WeakMap<RouteGraph, Compiled>();
function compile(g: RouteGraph): Compiled {
  let c = compiled.get(g);
  if (c) return c;
  const ids = [...g.byId.keys()];
  const index = new Map(ids.map((id, i) => [id, i] as const));
  const outs = ids.map((id) => g.out.get(id)!.map((way) => index.get(way.to)!));
  const ways = ids.map((id, i) => (g.exclusive(id) ? [...outs[i]!].sort((x, y) => g.bySeq(ids[x]!, ids[y]!)) : null));
  c = { ids, index, outs, ways, starts: g.starts.map((id) => index.get(id)!) };
  compiled.set(g, c);
  return c;
}

/** The nodes a set of picks reaches (`pick[i]`: the arm taken at fork i, -1 for the first in script order) and the arm taken at each fork reached. */
function walk(c: Compiled, pick: Int32Array) {
  const n = c.ids.length;
  const seen = new Uint8Array(n);
  const chosen = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  for (const start of c.starts) if (!seen[start]) (seen[start] = 1), (queue[tail++] = start);
  for (let head = 0; head < tail; head++) {
    const id = queue[head]!;
    const arms = c.ways[id];
    if (arms) {
      const at = pick[id]!;
      const arm = at >= 0 && arms.includes(at) ? at : arms[0]!;
      chosen[id] = arm;
      if (!seen[arm]) (seen[arm] = 1), (queue[tail++] = arm);
      continue;
    }
    for (const to of c.outs[id]!)
      if (!seen[to]) (seen[to] = 1), (queue[tail++] = to);
  }
  return { seen, chosen };
}

const weightArray = (c: Compiled, weights: Weights) => Int32Array.from(c.ids, (id) => weights.get(id) ?? 0);
const scoreOf = (seen: Uint8Array, w: Int32Array) => {
  let sum = 0;
  for (let i = 0; i < seen.length; i++) if (seen[i]) sum += w[i]!;
  return sum;
};
const pickArray = (c: Compiled, picks: Picks) => {
  const pick = new Int32Array(c.ids.length).fill(-1);
  for (const [fork, arm] of Object.entries(picks)) {
    const f = c.index.get(fork), a = c.index.get(arm);
    if (f !== undefined && a !== undefined) pick[f] = a;
  }
  return pick;
};

/** Untranslated lines on the route the picks give. */
export function routeLines(g: RouteGraph, weights: Weights, picks: Picks): number {
  const c = compile(g);
  return scoreOf(walk(c, pickArray(c, picks)).seen, weightArray(c, weights));
}

/** The picks with the most untranslated lines on their route, searched from `start`. */
export function bestRoute(g: RouteGraph, weights: Weights, start: Picks): NextRouteResult {
  const c = compile(g);
  const w = weightArray(c, weights);
  let pick: Int32Array = pickArray(c, start);
  let walked = walk(c, pick);
  let current = scoreOf(walked.seen, w);
  // A trial: switch one fork, then give the forks that appear with the new route their best arm.
  const trial = (fork: number, arm: number) => {
    const next = Int32Array.from(pick);
    next[fork] = arm;
    let tried = walk(c, next);
    let best = scoreOf(tried.seen, w);
    for (let id = 0; id < next.length; id++) {
      if (tried.chosen[id]! < 0 || walked.chosen[id]! >= 0) continue; // a fork that is new on this route
      for (const alt of c.ways[id]!) {
        if (alt === tried.chosen[id]) continue;
        const again = Int32Array.from(next);
        again[id] = alt;
        const result = walk(c, again);
        const value = scoreOf(result.seen, w);
        if (value > best) (best = value), (next[id] = alt), (tried = result);
      }
    }
    return { pick: next, value: best };
  };
  const order = (ids: number[]) => ids.sort((x, y) => g.bySeq(c.ids[x]!, c.ids[y]!));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    const forks = order(Array.from(walked.chosen.keys()).filter((id) => walked.chosen[id]! >= 0));
    for (const fork of forks) {
      const at = walked.chosen[fork]!;
      if (at < 0) continue; // dropped from the route by an earlier switch in this pass
      let best: { pick: Int32Array; value: number } | null = null;
      for (const arm of c.ways[fork]!) {
        if (arm === at) continue;
        const result = trial(fork, arm);
        if (result.value > (best?.value ?? current)) best = result;
      }
      if (best) {
        pick = best.pick;
        walked = walk(c, pick);
        current = best.value;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Keep a pick only where it differs from the default way (or was already stored): the rest read as unpicked.
  const kept: Picks = {};
  for (let fork = 0; fork < pick.length; fork++) {
    const arm = pick[fork]!;
    if (arm < 0) continue;
    const id = c.ids[fork]!;
    if (start[id] !== undefined || c.ways[fork]![0] !== arm) kept[id] = c.ids[arm]!;
  }
  return { picks: kept, lines: current };
}

export interface NextRoutePreview {
  /** The picks of the next route. */
  picks: Picks;
  /** Untranslated lines on the next route: what translating it adds. */
  newLines: number;
  /** Untranslated lines still on the current route. */
  totalUntranslatedOnRoute: number;
  /** Routes still to translate from here, the current one included while it has untranslated lines; REMAINING_CAP routes at most. */
  remainingRoutes: number | '20+';
  /** The next route is a different route. False with newLines > 0: the current route is still the best, translate it first. */
  changed: boolean;
}

export function previewNext(g: RouteGraph, weights: Weights, current: Picks): NextRoutePreview {
  const onRoute = routeLines(g, weights, current);
  const next = bestRoute(g, weights, current);
  const changed = sameRouteDiffers(g, current, next.picks);
  return { picks: next.picks, newLines: next.lines, totalUntranslatedOnRoute: onRoute, remainingRoutes: remaining(g, weights, current), changed };
}

/** Different picks can still walk the same nodes (a stale pick of a fork off the route). */
function sameRouteDiffers(g: RouteGraph, a: Picks, b: Picks) {
  const x = walkRoute(g, a).inSlice, y = walkRoute(g, b).inSlice;
  if (x.size !== y.size) return true;
  for (const id of x) if (!y.has(id)) return true;
  return false;
}

/** Simulates translating route after route: how many routes it takes to reach every reachable untranslated line. */
function remaining(g: RouteGraph, weights: Weights, current: Picks): number | '20+' {
  const left = new Map(weights);
  let picks = current;
  let count = 0;
  for (;;) {
    const route = walkRoute(g, picks).inSlice;
    let lines = 0;
    for (const id of route) lines += left.get(id) ?? 0;
    if (lines > 0) {
      count++;
      if (count >= REMAINING_CAP) return '20+';
      for (const id of route) left.set(id, 0);
    }
    const next = bestRoute(g, left, picks);
    if (next.lines === 0) return count;
    picks = next.picks;
  }
}

// ── project level ─────────────────────────────────────────────────────

export interface RouteProgress {
  /** Lines in graph nodes / how many of them have a translation. */
  graphLines: number;
  translatedGraphLines: number;
  /** Lines of the whole project / how many of them have a translation. */
  totalLines: number;
  translatedLines: number;
}

/** A line is translated when its translation text is not empty. */
export function translatedUnitIds(db: Db, projectId: string): Set<string> {
  return new Set(db.select({ id: s.units.id }).from(s.units).where(sql`${s.units.projectId} = ${projectId} and trim(coalesce(${s.units.translation}, '')) <> ''`).all().map((row) => row.id));
}

export function projectRouteInputs(db: Db, projectId: string) {
  const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key, kind: s.graphNodes.kind, unitIds: s.graphNodes.unitIds, label: s.graphNodes.label }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const edges = db.select({ from: s.graphEdges.fromId, to: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const units = new Map(db.select({ id: s.units.id, seq: s.units.seq }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit]));
  const translated = translatedUnitIds(db, projectId);
  const g = routeGraph(nodes, edges, units);
  const weights = untranslatedWeights(nodes, (id) => translated.has(id));
  return { g, weights };
}

/** Counts of translated lines for the project and the lines of the graph (no graph walk). */
export function routeProgress(db: Db, projectId: string, translated = translatedUnitIds(db, projectId)): RouteProgress & { translated: Set<string> } {
  const graphUnits = new Set(db.select({ unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().flatMap((node) => node.unitIds));
  const total = db.get<{ n: number }>(sql`select count(*) as n from ${s.units} where ${s.units.projectId} = ${projectId}`).n;
  let inGraph = 0;
  for (const id of graphUnits) if (translated.has(id)) inGraph++;
  return { graphLines: graphUnits.size, translatedGraphLines: inGraph, totalLines: total, translatedLines: translated.size, translated };
}

export const ROUTE_HISTORY = 50;
