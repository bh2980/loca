import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { lineFilterSchema, nodesBetween } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { nodeSetLayout } from './layout.ts';
import type { LayoutDirection } from './layout-types.ts';
import { events } from '../events.ts';
import { allLines } from './script-query.ts';

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
  const lineFilter = { ...(pick.speakers?.length && { speakers: pick.speakers }), ...(pick.lines?.length && { keys: pick.lines }), ...(pick.q && { q: pick.q }) };
  if (Object.keys(lineFilter).length) {
    const unitIds = allLines(db, projectId, lineFilterSchema.parse(lineFilter)).map((line) => line.id);
    if (pick.lines?.length) {
      const found = new Set(allLines(db, projectId, lineFilterSchema.parse({ keys: pick.lines })).map((line) => line.key));
      unknown.push(...pick.lines.filter((key) => !found.has(key)));
    }
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
  // Exact references only: a line key or id names the nodes holding that line, a node key or id the node.
  const resolve = (refs: string[]) => {
    const { nodes: all } = graph();
    const ids = new Set<string>();
    const units = refs.length ? db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all().filter((unit) => refs.includes(unit.id) || refs.includes(unit.key)) : [];
    const unitIds = new Set(units.map((unit) => unit.id));
    for (const node of all) if (refs.includes(node.id) || refs.includes(node.key) || node.unitIds.some((id) => unitIds.has(id))) ids.add(node.id);
    const known = new Set([...units.flatMap((unit) => [unit.id, unit.key]), ...all.filter((node) => ids.has(node.id)).flatMap((node) => [node.id, node.key])]);
    unknown.push(...refs.filter((ref) => !known.has(ref)));
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
}

/** Stores a new view of these nodes and returns its id. */
export function saveView(db: Db, projectId: string, nodeIds: string[], label: string, made: ViewOrigin = { origin: 'ai' }) {
  const ids = [...new Set(nodeIds)].sort();
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const reasons = Object.fromEntries(Object.entries(made.reasons ?? {}).filter(([nodeId, reason]) => ids.includes(nodeId) && reason.trim()));
  db.insert(s.graphViews).values({ id, projectId, label, nodeIds: ids, origin: made.origin, request: made.request ?? null, reasons }).run();
  events.changed(projectId, 'graph');
  return id;
}

/** Renames a view or changes its nodes; a changed node set drops its stored layouts, which are made again on the next open. */
export function updateView(db: Db, projectId: string, id: string, change: { label?: string; add?: string[]; remove?: string[] }) {
  const view = readView(db, projectId, id);
  if (!view) return null;
  const remove = new Set(change.remove ?? []);
  const nodeIds = [...new Set([...view.nodeIds.filter((nodeId) => !remove.has(nodeId)), ...(change.add ?? [])])].sort();
  const changed = nodeIds.join(',') !== view.nodeIds.join(',');
  const reasons = Object.fromEntries(Object.entries(view.reasons).filter(([nodeId]) => nodeIds.includes(nodeId)));
  db.transaction((tx) => {
    tx.update(s.graphViews).set({ label: change.label?.trim() || view.label, nodeIds, reasons, updatedAt: new Date() }).where(eq(s.graphViews.id, id)).run();
    if (changed) tx.delete(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.section, `view:${id}`))).run();
  });
  events.changed(projectId, 'graph');
  return readView(db, projectId, id)!;
}

export function deleteView(db: Db, projectId: string, id: string) {
  db.transaction((tx) => {
    tx.delete(s.graphLayouts).where(and(eq(s.graphLayouts.projectId, projectId), eq(s.graphLayouts.section, `view:${id}`))).run();
    tx.delete(s.graphViews).where(and(eq(s.graphViews.id, id), eq(s.graphViews.projectId, projectId))).run();
  });
  events.changed(projectId, 'graph');
}

/** The project's views, newest change first. */
export function listViews(db: Db, projectId: string) {
  return db
    .select({ id: s.graphViews.id, label: s.graphViews.label, origin: s.graphViews.origin, request: s.graphViews.request, nodeIds: s.graphViews.nodeIds, updatedAt: s.graphViews.updatedAt })
    .from(s.graphViews)
    .where(eq(s.graphViews.projectId, projectId))
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
  await nodeSetLayout(db, projectId, key, view.nodeIds, view.label, direction);
  return key;
}
