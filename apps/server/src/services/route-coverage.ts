import { isIdentifierLabel } from '@tw/shared';
import { walkRoute, type RouteGraph } from './route-slice.ts';
import type { Weights } from './next-route.ts';

/**
 * 남은 갈래 (docs/PLAN-30.md): which untranslated lines of the dialogue graph the current route does
 * not pass, grouped by the choice on the route where they leave it, and which lines no route reaches at
 * all. "No missed branches": every reachable untranslated line is in exactly one group until a route
 * passes it, and `throughPicks` gives a route that does.
 */
type Picks = Record<string, string>;

export interface RemainingBranch {
  /** The choice on the current route the branch leaves from. */
  fork: string;
  /** The arm the branch starts with. */
  arm: string;
  /** The arm's own label, when it names the way (numbering and export identifiers are left out). */
  label: string | null;
  /** Untranslated lines / all lines in the branch (nodes off the route that this arm reaches first). */
  untranslated: number;
  lines: number;
  /** The first node with untranslated lines, in script order: where 이 갈래로 takes the route. */
  firstNode: string;
}

export interface RouteCoverage {
  branches: RemainingBranch[];
  /** Untranslated lines in the branches together. */
  branchLines: number;
  /** Untranslated lines in nodes no route reaches (no path from any start). */
  unreachable: number;
}

/** Nodes some route reaches: from every start, every way at every fork. */
export function reachableAll(g: RouteGraph): Set<string> {
  const seen = new Set(g.starts);
  const queue = [...g.starts];
  for (let head = 0; head < queue.length; head++)
    for (const way of g.out.get(queue[head]!)!)
      if (!seen.has(way.to)) (seen.add(way.to), queue.push(way.to));
  return seen;
}

export function routeCoverage(g: RouteGraph, weights: Weights, picks: Picks): RouteCoverage {
  const { chosenAt, inSlice } = walkRoute(g, picks);
  const claimed = new Set<string>();
  const branches: RemainingBranch[] = [];
  for (const fork of [...chosenAt.keys()].sort(g.bySeq)) {
    const ways = g.out.get(fork)!.filter((way) => way.to !== chosenAt.get(fork) && !inSlice.has(way.to)).sort((a, b) => g.bySeq(a.to, b.to));
    for (const way of ways) {
      if (claimed.has(way.to)) continue;
      let untranslated = 0, lines = 0;
      let first: string | null = null;
      claimed.add(way.to);
      const queue = [way.to];
      for (let head = 0; head < queue.length; head++) {
        const id = queue[head]!;
        const w = weights.get(id) ?? 0;
        untranslated += w;
        lines += g.byId.get(id)!.unitIds.length;
        if (w > 0 && (first === null || g.bySeq(id, first) < 0)) first = id;
        for (const next of g.out.get(id)!)
          if (!inSlice.has(next.to) && !claimed.has(next.to)) (claimed.add(next.to), queue.push(next.to));
      }
      if (!first) continue;
      const label = way.label?.trim() || null;
      branches.push({ fork, arm: way.to, label: label && !g.numbering(g.out.get(fork)!) && !isIdentifierLabel(label) ? label : null, untranslated, lines, firstNode: first });
    }
  }
  const reachable = reachableAll(g);
  let unreachable = 0;
  for (const [id, w] of weights) if (!reachable.has(id)) unreachable += w;
  return { branches, branchLines: branches.reduce((sum, branch) => sum + branch.untranslated, 0), unreachable };
}

/**
 * The picks that take the route through `target`: the shortest way from the current route to it, with
 * each choice along that way picking it. Nothing else changes; null when no route reaches the target.
 */
export function throughPicks(g: RouteGraph, picks: Picks, target: string): Picks | null {
  if (!g.byId.has(target)) return null;
  const { inSlice } = walkRoute(g, picks);
  if (inSlice.has(target)) return picks;
  const from = new Map<string, string>();
  const queue = [...inSlice].sort(g.bySeq);
  const seen = new Set(queue);
  for (let head = 0; head < queue.length && !from.has(target); head++) {
    const id = queue[head]!;
    for (const way of [...g.out.get(id)!].sort((a, b) => g.bySeq(a.to, b.to)))
      if (!seen.has(way.to)) (seen.add(way.to), from.set(way.to, id), queue.push(way.to));
  }
  if (!from.has(target)) return null;
  const next = { ...picks };
  for (let at = target; from.has(at); at = from.get(at)!) {
    const fork = from.get(at)!;
    if (g.exclusive(fork)) next[fork] = at;
  }
  return next;
}
