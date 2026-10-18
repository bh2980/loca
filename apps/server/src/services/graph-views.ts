import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { isControlNode, lineFilterSchema, nodesBetween } from '@tw/shared';
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
  /** Leave out nodes without lines (conditions, waits, state changes); the view joins the flow across them. */
  simplify?: boolean;
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
  if (pick.exclude?.length) for (const id of resolve(pick.exclude)) nodes.delete(id);
  if (pick.simplify) for (const node of graph().nodes) if (nodes.has(node.id) && isControlNode(node)) nodes.delete(node.id);
  return { nodeIds: [...nodes], unknown, scenes: groups.filter((group) => sceneIds.has(group.id)).map((group) => group.title) };
}

/** Stores a set of nodes (same set, same id) and returns its id. */
export function saveView(db: Db, projectId: string, nodeIds: string[], label: string) {
  const ids = [...new Set(nodeIds)].sort();
  const id = createHash('sha1').update(`${projectId}:${ids.join(',')}`).digest('hex').slice(0, 16);
  db.insert(s.graphViews).values({ id, projectId, label, nodeIds: ids }).onConflictDoUpdate({ target: s.graphViews.id, set: { label } }).run();
  events.changed(projectId, 'graph');
  return id;
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
