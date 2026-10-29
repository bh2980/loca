import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { badRequest } from '../http-errors.ts';

/**
 * Reading a saved view of the dialogue graph (graph-views.ts stores them) as a part of the script:
 * its lines in reading order, for `--view` scopes and exports. Kept apart from graph-views.ts, which
 * reads lines through script-query.ts, so that script-query can use it.
 */

const stored = (db: Db, id: string) => db.select({ id: s.graphViews.id, label: s.graphViews.label, nodeIds: s.graphViews.nodeIds }).from(s.graphViews).where(eq(s.graphViews.id, id)).get()!;

/** A stored view by id or label: exact, then the one label containing it. */
export function findView(db: Db, projectId: string, ref: string) {
  const views = db.select({ id: s.graphViews.id, label: s.graphViews.label }).from(s.graphViews).where(eq(s.graphViews.projectId, projectId)).all();
  const lower = ref.toLowerCase();
  const match = views.find((view) => view.id === ref) ?? views.find((view) => view.label.toLowerCase() === lower);
  if (match) return stored(db, match.id);
  const partial = views.filter((view) => view.label.toLowerCase().includes(lower));
  if (partial.length === 1) return stored(db, partial[0].id);
  const named = (partial.length ? partial : views).slice(0, 10).map((view) => view.label);
  return badRequest(`${partial.length ? '여러 보기가 맞습니다' : '보기를 찾지 못했습니다'}: ${ref}${named.length ? ` (${named.join(', ')})` : ''}`);
}

export interface FlowNode {
  id: string;
  key: string;
  label: string | null;
  units: string[];
  /** Ways in and out that stay inside the view, by node id. */
  incoming: { from: string; label: string | null }[];
  outgoing: { to: string; label: string | null }[];
}

/**
 * A view's nodes in reading order: every node after the nodes of the view leading into it, script
 * order where the edges do not say (several starts, parallel branches, the way back into a loop).
 * Edges are only those between nodes of the view.
 */
export function viewFlow(db: Db, projectId: string, ref: string) {
  const view = findView(db, projectId, ref);
  const ids = new Set(view.nodeIds);
  const nodes = inChunks(view.nodeIds, (slice) => db.select({ id: s.graphNodes.id, key: s.graphNodes.key, label: s.graphNodes.label, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(inArray(s.graphNodes.id, slice)).all());
  const edges = inChunks(view.nodeIds, (slice) => db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId, label: s.graphEdges.label }).from(s.graphEdges).where(inArray(s.graphEdges.fromId, slice)).all()).filter((edge) => ids.has(edge.toId));
  const seq = new Map(inChunks([...new Set(nodes.flatMap((node) => node.unitIds))], (slice) => db.select({ id: s.units.id, seq: s.units.seq }).from(s.units).where(inArray(s.units.id, slice)).all()).map((row) => [row.id, row.seq]));
  const at = new Map(nodes.map((node) => [node.id, Math.min(...node.unitIds.map((unitId) => seq.get(unitId) ?? Infinity))]));
  const byId = new Map<string, FlowNode>(nodes.map((node) => [node.id, { id: node.id, key: node.key, label: node.label, units: node.unitIds, incoming: [], outgoing: [] }]));
  for (const edge of edges) {
    byId.get(edge.toId)!.incoming.push({ from: edge.fromId, label: edge.label });
    byId.get(edge.fromId)!.outgoing.push({ to: edge.toId, label: edge.label });
  }
  // Kahn's order, earliest in the script first; a loop is entered at its earliest node.
  const waiting = new Map(nodes.map((node) => [node.id, byId.get(node.id)!.incoming.filter((way) => way.from !== node.id).length]));
  const before = (a: string, b: string) => (at.get(a)! - at.get(b)!) || (byId.get(a)!.key < byId.get(b)!.key ? -1 : 1);
  const ready = nodes.filter((node) => waiting.get(node.id) === 0).map((node) => node.id);
  const order: FlowNode[] = [];
  const done = new Set<string>();
  while (order.length < nodes.length) {
    // Nothing free means a loop: go in at its earliest node.
    const pool = ready.length ? ready : [...waiting.keys()].filter((id) => !done.has(id));
    const next = pool.reduce((best, id) => (before(id, best) < 0 ? id : best));
    if (ready.length) ready.splice(ready.indexOf(next), 1);
    if (done.has(next)) continue;
    done.add(next);
    const node = byId.get(next)!;
    order.push(node);
    for (const way of node.outgoing) {
      if (done.has(way.to)) continue;
      const left = waiting.get(way.to)! - 1;
      waiting.set(way.to, left);
      if (left === 0) ready.push(way.to);
    }
  }
  return { view: { id: view.id, label: view.label }, nodes: order };
}

/** The lines of a view in reading order (see viewFlow). */
export const viewUnitIds = (db: Db, projectId: string, ref: string) => viewFlow(db, projectId, ref).nodes.flatMap((node) => node.units);
