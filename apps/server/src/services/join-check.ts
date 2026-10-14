import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { projectSlice, type RouteSlice } from './route-slice.ts';

/**
 * 합류 점검 (docs/DESIGN.md J2c): the lines right after a join are reached from other choices too,
 * so their translation has to read naturally after every incoming route. For one join this gathers
 * each incoming route with its last lines before the join, and the first lines after it. Only graph
 * edges are followed; nothing is guessed.
 */
const LINES = 2;
/** Nodes a route search may visit before it gives up (the route is then shown without lines). */
const SCAN = 5_000;

export interface JoinLine {
  unitId: string;
  key: string;
  groupId: string;
  speaker: string | null;
  source: string;
  translation: string | null;
}
export interface JoinRoute {
  /** `path:<block>` for a way the chosen path arrives by, `stub:<fork>:<arm>` for another choice. */
  id: string;
  kind: 'path' | 'stub';
  /** The choice's name for a stub; null for the chosen path. */
  label: string | null;
  /** The last lines before the join, in order (fewer than 2 when the route holds fewer). */
  before: JoinLine[];
}
export type JoinCheckState = 'checked' | 'stale';
export interface JoinDetail {
  nodeId: string;
  routes: JoinRoute[];
  /** The first lines from the join on, shared by every route. */
  after: JoinLine[];
  /** Hash of the involved lines' ids and translations; what a check is stored against. */
  sig: string;
  /** The stored check, with whether the lines still read as they did. */
  check: { at: string; state: JoinCheckState } | null;
}

type RouteIds = { id: string; kind: 'path' | 'stub'; label: string | null; unitIds: string[] };

/** The joins that can be checked: places another choice comes back to (the overview's join anchors). Ways that only meet inside a parallel section are not. */
export const checkableJoins = (slice: RouteSlice) => slice.overview.nodes.filter((node) => node.kind === 'anchor' && node.join).map((node) => node.id);

/** The unit ids of each incoming route and of the lines after the join; null when `blockId` is not a join of the slice. */
export function joinLines(
  slice: RouteSlice,
  nodes: { id: string; unitIds: string[] }[],
  edges: { from: string; to: string }[],
  blockId: string,
): { routes: RouteIds[]; after: string[] } | null {
  if (!checkableJoins(slice).includes(blockId)) return null;
  const blocks = new Map(slice.blocks.map((block) => [block.id, block]));
  const join = blocks.get(blockId)!;
  const pathInto = new Map<string, string[]>();
  const pathOut = new Map<string, string[]>();
  for (const edge of slice.edges) {
    if (edge.kind !== 'path') continue;
    pathInto.set(edge.to, [...(pathInto.get(edge.to) ?? []), edge.from]);
    pathOut.set(edge.from, [...(pathOut.get(edge.from) ?? []), edge.to]);
  }

  // The chosen path: walk back from each predecessor, through blocks without lines, while the way is single.
  const tail = (start: string) => {
    const ids: string[] = [];
    const seen = new Set<string>();
    let at: string | undefined = start;
    while (at && !seen.has(at) && ids.length < LINES) {
      seen.add(at);
      const block = blocks.get(at);
      if (!block) break;
      ids.unshift(...block.unitIds.slice(-(LINES - ids.length)));
      const before: string[] = pathInto.get(at) ?? [];
      at = before.length === 1 ? before[0] : undefined;
    }
    return ids.slice(-LINES);
  };
  const preds = pathInto.get(blockId) ?? [];
  const routes: RouteIds[] = preds.map((pred, i) => ({ id: `path:${pred}`, kind: 'path', label: preds.length > 1 ? `고른 길 ${i + 1}/${preds.length}` : null, unitIds: tail(pred) }));

  // Other choices: the shortest way from the arm to the join through nodes outside the slice.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const out = new Map<string, string[]>();
  for (const edge of edges) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
  const inSlice = new Set(slice.blocks.flatMap((block) => block.nodeIds));
  const targets = new Set(join.nodeIds);
  for (const stub of slice.stubs) {
    const reach = stub.rejoins.find((id) => targets.has(id));
    if (!reach) continue;
    const parent = new Map<string, string | null>([[stub.arm, null]]);
    let found = false;
    for (let queue = [stub.arm], head = 0; head < queue.length && parent.size < SCAN && !found; head++) {
      const id = queue[head]!;
      if (id === reach) {
        found = true;
        break;
      }
      for (const next of out.get(id) ?? []) {
        if (parent.has(next) || (inSlice.has(next) && next !== reach)) continue;
        parent.set(next, id);
        queue.push(next);
      }
    }
    const ids: string[] = [];
    if (found) {
      const way: string[] = [];
      for (let at: string | null | undefined = parent.get(reach); at; at = parent.get(at)) way.unshift(at);
      for (const id of way) ids.push(...(nodeById.get(id)?.unitIds ?? []));
    }
    routes.push({ id: stub.id, kind: 'stub', label: stub.label, unitIds: ids.slice(-LINES) });
  }

  // After the join: its own lines, then on along a single way while it has fewer than two.
  const after: string[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined = blockId; at && !seen.has(at) && after.length < LINES; ) {
    seen.add(at);
    after.push(...(blocks.get(at)?.unitIds ?? []).slice(0, LINES - after.length));
    const next: string[] = pathOut.get(at) ?? [];
    at = next.length === 1 ? next[0] : undefined;
  }
  return { routes, after };
}

/** What a check is stored against: the involved lines in order, with their translations. */
export function joinSignature(unitIds: string[], translations: Map<string, string | null>) {
  const ids = [...new Set(unitIds)];
  return createHash('sha1').update(JSON.stringify(ids.map((id) => [id, translations.get(id) ?? '']))).digest('hex').slice(0, 16);
}

function loadGraph(db: Db, projectId: string) {
  const nodes = db.select({ id: s.graphNodes.id, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const edges = db.select({ from: s.graphEdges.fromId, to: s.graphEdges.toId }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  return { nodes, edges };
}

const unitRows = (db: Db, ids: string[]) =>
  new Map(
    (ids.length
      ? db.select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, speaker: s.units.speaker, source: s.units.source, translation: s.units.translation }).from(s.units).where(inArray(s.units.id, ids)).all()
      : []
    ).map((row) => [row.id, row]),
  );

const stateOf = (stored: { sig: string }, sig: string): JoinCheckState => (stored.sig === sig ? 'checked' : 'stale');

/** The join with its routes and lines, or null when `nodeId` is not a join of the project's current slice. */
export function joinDetail(db: Db, projectId: string, nodeId: string): JoinDetail | null {
  const slice = projectSlice(db, projectId);
  const { nodes, edges } = loadGraph(db, projectId);
  const found = joinLines(slice, nodes, edges, nodeId);
  if (!found) return null;
  const all = [...found.routes.flatMap((route) => route.unitIds), ...found.after];
  const rows = unitRows(db, [...new Set(all)]);
  const line = (unitId: string): JoinLine => {
    const row = rows.get(unitId);
    return { unitId, key: row?.key ?? '', groupId: row?.groupId ?? '', speaker: row?.speaker ?? null, source: row?.source ?? '', translation: row?.translation ?? null };
  };
  const sig = joinSignature(all, new Map([...rows].map(([id, row]) => [id, row.translation])));
  const stored = db.select({ checks: s.projects.joinChecks }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.checks?.[nodeId];
  return {
    nodeId,
    routes: found.routes.map((route) => ({ id: route.id, kind: route.kind, label: route.label, before: route.unitIds.map(line) })),
    after: found.after.map(line),
    sig,
    check: stored ? { at: stored.at, state: stateOf(stored, sig) } : null,
  };
}

/** The checked joins of the current slice with their state; joins nobody checked are not listed (nothing to compute for them). */
export function joinStates(db: Db, projectId: string): Record<string, { at: string; state: JoinCheckState }> {
  const checks = db.select({ checks: s.projects.joinChecks }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.checks ?? {};
  if (!Object.keys(checks).length) return {};
  const slice = projectSlice(db, projectId);
  const marked = checkableJoins(slice).filter((id) => checks[id]);
  if (!marked.length) return {};
  const { nodes, edges } = loadGraph(db, projectId);
  const found = marked.map((id) => [id, joinLines(slice, nodes, edges, id)!] as const);
  const rows = unitRows(db, [...new Set(found.flatMap(([, f]) => [...f.routes.flatMap((route) => route.unitIds), ...f.after]))]);
  const translations = new Map([...rows].map(([id, row]) => [id, row.translation]));
  return Object.fromEntries(found.map(([id, f]) => [id, { at: checks[id]!.at, state: stateOf(checks[id]!, joinSignature([...f.routes.flatMap((route) => route.unitIds), ...f.after], translations)) }]));
}
