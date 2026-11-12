import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { lineFilterSchema, nodesBetween } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { inChunks, inList } from '../db/chunk.ts';
import { nodeSetLayout, cancelViewLayouts } from './layout.ts';
import type { LayoutDirection } from './layout-types.ts';
import { allLines } from './script-query.ts';
import { projectReadingRoute } from './reading-route.ts';

/** What an agent can pick graph nodes by; every part is optional and they add up. */
export interface NodePick {
  /** Scene ids, keys or titles: every node in them. */
  scenes?: string[];
  /** Lines these characters speak (names, aliases or speaker keys). */
  speakers?: string[];
  /** Line keys. */
  lines?: string[];
  /** Lines whose source, translation, speaker or key contains this text. */
  q?: string;
  /** Also the nodes this many steps before and after the picked ones (0–5). */
  around?: number;
  /** Every node on any path from `start` to `end` (line keys or ids, node keys or ids): all branches between them. */
  between?: { start: string; end: string };
  /** Line keys or ids, node keys or ids to leave out. */
  exclude?: string[];
  /** Nodes picked one by one (line keys or ids, node keys or ids), each with why it is kept. */
  keep?: { ref: string; reason?: string }[];
}

function lazy<T>(make: () => T) {
  let value: T | undefined;
  return () => (value ??= make());
}

/** Most nodes one view holds; past this the agent is asked to narrow it. */
export const VIEW_LIMIT = 5_000;

/** The graph nodes a pick names, and what it could not find. */
export function pickNodes(db: Db, projectId: string, pick: NodePick) {
  const nodes = new Set<string>();
  const unknown: string[] = [];
  const groups = db.select({ id: s.groups.id, key: s.groups.key, title: s.groups.title }).from(s.groups).where(eq(s.groups.projectId, projectId)).all();
  const sceneIds = new Set<string>();
  for (const scene of pick.scenes ?? []) {
    const lower = scene.toLowerCase();
    const match = groups.filter((group) => group.id === scene || group.key === scene || group.title.toLowerCase() === lower);
    if (match.length) for (const group of match) sceneIds.add(group.id);
    else unknown.push(scene);
  }
  if (sceneIds.size)
    for (const row of db.select({ id: s.graphNodes.id, groupId: s.graphNodes.groupId }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all())
      if (row.groupId && sceneIds.has(row.groupId)) nodes.add(row.id);
  // Lines → the graph nodes that hold them.
  // Keys that are no line are reported with the other picks not found; the pick goes on with the lines that are.
  const keys = pick.lines?.length ? inChunks(pick.lines, (slice) => db.select({ key: s.units.key }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.key, slice))).all()).map((row) => row.key) : undefined;
  if (keys) unknown.push(...pick.lines!.filter((key) => !keys.includes(key)));
  const lineFilter = { ...(pick.speakers?.length && { speakers: pick.speakers }), ...(keys && { keys }), ...(pick.q && { q: pick.q }) };
  // Named lines of which none exists pick no line (an empty list of keys would be no condition).
  if (Object.keys(lineFilter).length && keys?.length !== 0) {
    const unitIds = allLines(db, projectId, lineFilterSchema.parse(lineFilter)).map((line) => line.id);
    if (unitIds.length)
      for (const row of db.all<{ id: string }>(sql`
        select distinct n.id as id from ${s.graphNodes} n, json_each(n.unit_ids) j
        where n.project_id = ${projectId} and j.value in (select value from json_each(${JSON.stringify(unitIds)}))`))
        nodes.add(row.id);
  }
  const graph = lazy(() => ({
    nodes: db.select({ id: s.graphNodes.id, key: s.graphNodes.key, kind: s.graphNodes.kind, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all(),
    edges: db.select({ from: s.graphEdges.fromId, to: s.graphEdges.toId }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all(),
  }));
  // Resolve every reference against one index, including lines with no graph node.
  const references = lazy(() => {
    const index = new Map<string, Set<string>>();
    const byUnit = new Map<string, Set<string>>();
    const add = (key: string, ids: Iterable<string>) => {
      const found = index.get(key) ?? new Set<string>();
      for (const id of ids) found.add(id);
      index.set(key, found);
    };
    for (const node of graph().nodes) {
      add(node.id, [node.id]);
      add(node.key, [node.id]);
      for (const id of node.unitIds) {
        const found = byUnit.get(id) ?? new Set<string>();
        found.add(node.id);
        byUnit.set(id, found);
      }
    }
    for (const unit of db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all()) {
      const ids = byUnit.get(unit.id) ?? [];
      add(unit.id, ids);
      add(unit.key, ids);
    }
    return index;
  });
  const resolve = (refs: string[]) => {
    const ids = new Set<string>();
    for (const ref of refs) {
      const found = references().get(ref);
      if (found) for (const id of found) ids.add(id);
      else unknown.push(ref);
    }
    return ids;
  };
  if (pick.between) {
    const start = resolve([pick.between.start]);
    const end = resolve([pick.between.end]);
    if (start.size && end.size) for (const id of nodesBetween(graph().edges, start, end)) nodes.add(id);
  }
  const around = Math.min(5, Math.max(0, pick.around ?? 0));
  if (around && nodes.size) {
    const { edges } = graph();
    const near = new Map<string, string[]>();
    for (const edge of edges) {
      (near.get(edge.from) ?? near.set(edge.from, []).get(edge.from)!).push(edge.to);
      (near.get(edge.to) ?? near.set(edge.to, []).get(edge.to)!).push(edge.from);
    }
    let frontier = [...nodes];
    for (let step = 0; step < around; step++) {
      const next: string[] = [];
      for (const id of frontier) for (const other of near.get(id) ?? []) if (!nodes.has(other)) (nodes.add(other), next.push(other));
      frontier = next;
    }
  }
  const reasons: Record<string, string> = {};
  for (const { ref, reason } of pick.keep ?? [])
    for (const id of resolve([ref])) {
      nodes.add(id);
      if (reason?.trim()) reasons[id] = reason.trim();
    }
  if (pick.exclude?.length) for (const id of resolve(pick.exclude)) nodes.delete(id);
  return { nodeIds: [...nodes], reasons, unknown, scenes: groups.filter((group) => sceneIds.has(group.id)).map((group) => group.title) };
}

/** How a view was made: by the chat from a request (with why each node was kept), or by a person from a selection. */
export interface ViewOrigin {
  origin: 'ai' | 'manual';
  request?: string | null;
  reasons?: Record<string, string>;
  /** Made from one reading route: it holds that route's nodes. */
  route?: ViewRoute;
}

/** One reading route: its two end nodes and the branch chosen at each fork (`fork:target,…`, the route view's own format). */
export interface ViewRoute {
  start: string;
  end: string;
  via?: string;
}

/** The nodes a route view holds: every node the reading route goes through, or why there is no route. */
export function routeNodes(db: Db, projectId: string, route: ViewRoute): { nodeIds: string[] } | { error: string } {
  const found = projectReadingRoute(db, projectId, { start: route.start, end: route.end, via: route.via || undefined });
  if (found.status !== 'found' || !found.nodeIds.length) return { error: '시작과 끝을 잇는 길이 없습니다.' };
  return { nodeIds: found.nodeIds };
}

/** Stores a new view of these nodes and returns its id. */
export function saveView(db: Db, projectId: string, nodeIds: string[], label: string, made: ViewOrigin = { origin: 'ai' }) {
  const ids = [...new Set(nodeIds)].sort();
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const reasons = Object.fromEntries(Object.entries(made.reasons ?? {}).filter(([nodeId, reason]) => ids.includes(nodeId) && reason.trim()));
  const route = made.route ? { start: made.route.start, end: made.route.end, ...(made.route.via && { via: made.route.via }) } : null;
  db.insert(s.graphViews).values({ id, projectId, label, nodeIds: ids, origin: made.origin, request: made.request ?? null, reasons, route }).run();
  return id;
}

/**
 * Renames a view or changes its nodes; a changed node set drops its stored layouts, which are made again on the next open.
 * A route view changes its nodes by `via` (another branch at a fork: the route's nodes again); nodes added or left out
 * by hand make it a plain view of nodes, since it no longer is that route.
 */
export function updateView(db: Db, projectId: string, id: string, change: { label?: string; add?: string[]; remove?: string[]; via?: string }) {
  const view = readView(db, projectId, id);
  if (!view) return null;
  let route = view.route;
  let base = view.nodeIds;
  if (change.via !== undefined) {
    if (!route) return { error: '경로로 만든 보기가 아니라 갈림길을 바꿀 수 없습니다.' } as const;
    route = { start: route.start, end: route.end, ...(change.via && { via: change.via }) };
    const found = routeNodes(db, projectId, route);
    if ('error' in found) return found;
    base = [...new Set(found.nodeIds)].sort();
  }
  const remove = new Set(change.remove ?? []);
  const nodeIds = [...new Set([...base.filter((nodeId) => !remove.has(nodeId)), ...(change.add ?? [])])].sort();
  if (route && nodeIds.join(',') !== base.join(',')) route = null;
  const changed = nodeIds.join(',') !== view.nodeIds.join(',') || Boolean(change.label?.trim() && change.label.trim() !== view.label);
  const reasons = Object.fromEntries(Object.entries(view.reasons).filter(([nodeId]) => nodeIds.includes(nodeId)));
  db.transaction((tx) => {
    tx.update(s.graphViews).set({ label: change.label?.trim() || view.label, nodeIds, reasons, route, updatedAt: new Date() }).where(eq(s.graphViews.id, id)).run();
    if (changed) cancelViewLayouts(projectId, `view:${id}`);
    if (changed) tx.delete(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.section, `view:${id}`))).run();
  });
  return readView(db, projectId, id)!;
}

export function deleteView(db: Db, projectId: string, id: string) {
  cancelViewLayouts(projectId, `view:${id}`);
  db.transaction((tx) => {
    tx.delete(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.section, `view:${id}`))).run();
    tx.delete(s.graphViews).where(and(eq(s.graphViews.id, id), eq(s.graphViews.projectId, projectId))).run();
  });
}

/** The project's views, newest change first. */
export function listViews(db: Db, projectId: string, ids?: readonly string[]) {
  return db
    .select({ id: s.graphViews.id, label: s.graphViews.label, origin: s.graphViews.origin, request: s.graphViews.request, route: s.graphViews.route, nodeIds: s.graphViews.nodeIds, updatedAt: s.graphViews.updatedAt })
    .from(s.graphViews)
    .where(and(eq(s.graphViews.projectId, projectId), ids ? inList(s.graphViews.id, ids) : undefined))
    .all()
    .map(({ nodeIds, ...view }) => ({ ...view, nodes: nodeIds.length }))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Node ids a view keeps that the source graph no longer has (a re-import or source edit removed them). */
export function missingNodes(db: Db, projectId: string, nodeIds: string[]) {
  const present = new Set(db.select({ id: s.graphNodes.id }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().map((row) => row.id));
  return nodeIds.filter((id) => !present.has(id));
}

export function readView(db: Db, projectId: string, id: string) {
  return db.select().from(s.graphViews).where(and(eq(s.graphViews.id, id), eq(s.graphViews.projectId, projectId))).get();
}

/** The section of a script that holds most of these nodes (where a highlight is best shown). */
export function sectionWithMost(db: Db, projectId: string, nodeIds: string[]) {
  const wanted = new Set(nodeIds);
  const sectionOf = new Map(db.select({ id: s.groups.id, section: s.groups.section }).from(s.groups).where(eq(s.groups.projectId, projectId)).all().map((group) => [group.id, group.section]));
  const counts = new Map<string, number>();
  for (const node of db.select({ id: s.graphNodes.id, groupId: s.graphNodes.groupId }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all()) {
    const section = wanted.has(node.id) && node.groupId ? sectionOf.get(node.groupId) : null;
    if (section) counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Lays out a stored view on its own (once) and returns the section key the graph route serves it under. */
export async function viewSection(db: Db, projectId: string, id: string, direction: LayoutDirection = 'vertical') {
  const view = readView(db, projectId, id);
  if (!view) throw new Error('없는 보기입니다.');
  const key = `view:${id}`;
  await nodeSetLayout(db, projectId, key, view.nodeIds, view.label, direction, !view.route);
  return key;
}
