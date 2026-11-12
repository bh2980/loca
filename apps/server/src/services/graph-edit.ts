import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { createUnitSchema, type GraphOrigin } from '@loca/shared';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { badRequest, found } from '../refusal.ts';
import { changed, initialStatus, invalidate, refreshNodeGroups, refuseBusy, resequence, type Tx } from './source-mutations.ts';
import { namedListener } from '../domain/line-listener.ts';
import { PERSON, type Saver } from '../domain/saver.ts';
import { recorder, type UndoRecorder } from './undo-records.ts';

/**
 * The structure of the script and its dialogue graph, changed in one place for every surface (the script list, the
 * graph editor, the agent's tools through the change gate): adding a line (createLine), deleting lines, nodes and
 * scenes (deleteLines, deleteNodes, deleteGroup), drawing and deleting the graph's lines, copying nodes. The project
 * is the source of truth (an import is one way in), so these are ordinary edits; what a person or the AI made carries
 * its origin. Every edit answers with the id of its undo record (`token`, null when it changed nothing): what it
 * removed, rewrote and made, kept in the database (undo-records.ts) and put back with undoRecorded.
 */

/** Runs one edit in a transaction, then lays the graph out again; returns the edit's result and its undo record. `kind`: what it changes, as the agent permissions name it. */
function edit<T>(db: Db, projectId: string, kind: 'script' | 'scenes', work: (tx: Tx, record: UndoRecorder) => T): T & { token: string | null } {
  const result = db.transaction((tx) => {
    const record = recorder(tx, projectId);
    const value = work(tx, record);
    refreshNodeGroups(tx, projectId);
    resequence(tx, projectId);
    invalidate(tx, projectId);
    return { value, token: record.save(kind) };
  });
  changed(db, projectId);
  return { ...result.value, token: result.token };
}

const nodeOf = (db: Pick<Db, 'select'>, projectId: string, id: string) => found(db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.id, id))).get(), '그래프 노드');

/** A line from one node to another (none twice); an existing one is kept as it is. */
export function linkNodes(db: Db, projectId: string, input: { fromId: string; toId: string; label?: string | null; origin: GraphOrigin }) {
  if (input.fromId === input.toId) badRequest('같은 노드끼리는 이을 수 없습니다.');
  nodeOf(db, projectId, input.fromId);
  nodeOf(db, projectId, input.toId);
  const existing = db.select().from(s.graphEdges).where(and(eq(s.graphEdges.fromId, input.fromId), eq(s.graphEdges.toId, input.toId))).get();
  if (existing) return { edge: existing, token: null };
  return edit(db, projectId, 'script', (tx, record) => {
    const edge = tx.insert(s.graphEdges).values({ projectId, fromId: input.fromId, toId: input.toId, label: input.label ?? null, origin: input.origin }).returning().get();
    record.made('graph_edges', edge.id);
    return { edge };
  });
}

/** Deletes lines between nodes. */
export function unlinkEdges(db: Db, projectId: string, ids: string[]) {
  const rows = inChunks(ids, (slice) => db.select({ id: s.graphEdges.id }).from(s.graphEdges).where(and(eq(s.graphEdges.projectId, projectId), inArray(s.graphEdges.id, slice))).all());
  if (!rows.length) badRequest('지울 선이 없습니다.');
  return edit(db, projectId, 'script', (tx, record) => {
    const edgeIds = rows.map((row) => row.id);
    record.removed('graph_edges', 'id', edgeIds);
    for (const slice of inChunks(edgeIds, (part) => [part])) tx.delete(s.graphEdges).where(inArray(s.graphEdges.id, slice)).run();
    return { deleted: rows.length };
  });
}

/** Where a new line goes: at the end of a group, or right after a node of the dialogue graph, in that node's scene. */
export type LinePlace = { groupId: string } | { afterNodeId: string };
const newLineSchema = createUnitSchema.omit({ groupId: true });

/**
 * Inside an edit, the one insert of a line: its key is its own in the project (refused otherwise), and it starts in
 * the project's initial status without a translation. A new line and a copy of one both come here.
 */
function insertLine(tx: Tx, record: UndoRecorder, projectId: string, line: Pick<typeof s.units.$inferInsert, 'groupId' | 'kind' | 'key' | 'source' | 'speaker' | 'listener' | 'listenerOrigin' | 'listenerConfidence' | 'sort'>) {
  if (tx.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, line.key))).get()) badRequest(`이미 사용 중인 키입니다: ${line.key}`);
  const unit = tx.insert(s.units).values({ ...line, projectId, statusId: initialStatus(tx, projectId) }).returning().get();
  record.made('units', unit.id);
  return unit;
}

/**
 * A new source line, the one way any surface adds one. Its key is its own in the project (made up when none is
 * given), it starts in the project's initial status without a translation, and it gets a graph node of its own:
 * alone at the end of a group (no connection is invented), or joined in after a node — when that node has one way
 * on (A → B; links to hubs do not count) the new line goes between them (A → new → B, the way's label stays on A's
 * side), when it has none or several (a branch) it is another way out of A. Only a scene's lines have a speaker and
 * a listener. `by`: who adds it (the app's person unless told): the origin of its node and lines, and of the
 * listener it names.
 */
export function createLine(db: Db, projectId: string, place: LinePlace, raw: z.input<typeof newLineSchema>, by: { origin: GraphOrigin; saver: Saver } = { origin: 'human', saver: PERSON }) {
  const input = newLineSchema.parse(raw);
  const after = 'afterNodeId' in place ? nodeOf(db, projectId, place.afterNodeId) : undefined;
  const last = after?.unitIds.length ? db.select().from(s.units).where(inArray(s.units.id, after.unitIds)).all().sort((a, b) => b.sort - a.sort)[0] : undefined;
  const groupId = 'groupId' in place ? place.groupId : (last?.groupId ?? after?.groupId);
  if (!groupId) badRequest('장면에 속하지 않은 노드 뒤에는 대사를 넣을 수 없습니다.');
  const group = found(db.select().from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.id, groupId))).get(), '묶음');
  if (after && group.kind !== 'scene') badRequest('대사 그래프에는 장면의 대사만 넣을 수 있습니다.');
  if (group.kind !== 'scene' && (input.speaker || input.listener)) badRequest('문서와 UI 항목에는 화자·청자를 지정하지 않습니다.');
  const key = input.key ?? `entry-${randomUUID()}`;
  const made = edit(db, projectId, 'script', (tx, record) => {
    // Its place in the group's order: right after the node's last line (later lines move down one), else at the end.
    const sort = last ? last.sort + 1 : tx.get<{ n: number }>(sql`select coalesce(max(sort), -1) + 1 n from ${s.units} where group_id = ${group.id}`)!.n;
    if (last)
      for (const later of tx.select({ id: s.units.id, sort: s.units.sort }).from(s.units).where(and(eq(s.units.groupId, group.id), gt(s.units.sort, sort - 1))).all()) {
        record.rewritten('units', later.id, ['sort']);
        tx.update(s.units).set({ sort: later.sort + 1 }).where(eq(s.units.id, later.id)).run();
      }
    const unit = insertLine(tx, record, projectId, { groupId: group.id, key, source: input.source, speaker: input.speaker ?? null, listener: input.listener ?? null, kind: group.kind === 'scene' ? 'dialogue' : group.kind, sort, ...(input.listener ? namedListener(by.saver) : {}) });
    const node = tx.insert(s.graphNodes).values({ projectId, key: `entry-${unit.id}`, kind: 'script', groupId: group.id, unitIds: [unit.id], meta: { manualSourceEntry: true }, origin: by.origin }).returning().get();
    record.made('graph_nodes', node.id);
    if (after) {
      // Its ways on, leaving out links to hubs (connector nodes that tie many lines to a state): those are not the next line.
      const hubs = new Set(tx.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.kind, 'connector'))).all().map((row) => row.id));
      const outs = tx.select().from(s.graphEdges).where(eq(s.graphEdges.fromId, after.id)).all().filter((edge) => !hubs.has(edge.toId));
      const link = (fromId: string, toId: string, label: string | null) => record.made('graph_edges', tx.insert(s.graphEdges).values({ projectId, fromId, toId, label, origin: by.origin }).returning().get().id);
      if (outs.length === 1) {
        const [way] = outs;
        record.removed('graph_edges', 'id', [way!.id]);
        tx.delete(s.graphEdges).where(eq(s.graphEdges.id, way!.id)).run();
        link(after.id, node.id, way!.label);
        link(node.id, way!.toId, null);
      } else link(after.id, node.id, null);
    }
    return { unitId: unit.id, nodeId: node.id };
  });
  // Read once the script's order is settled (its seq).
  return { ...made, unit: db.select().from(s.units).where(eq(s.units.id, made.unitId)).get()! };
}

/**
 * Inside an edit: removes these nodes (not their lines). With `bridge`, the way through them is kept:
 * whatever led into the deleted run now leads to whatever it led to (A → B → C, B deleted: A → C), with
 * the label the way in had. A choice deleted without `bridge` takes its option away.
 */
function removeNodes(tx: Tx, record: UndoRecorder, projectId: string, nodes: (typeof s.graphNodes.$inferSelect)[], bridge: boolean) {
  const gone = new Set(nodes.map((node) => node.id));
  const touching = inChunks([...gone], (slice) => tx.select().from(s.graphEdges).where(or(inArray(s.graphEdges.fromId, slice), inArray(s.graphEdges.toId, slice))).all());
  const unique = [...new Map(touching.map((edge) => [edge.id, edge])).values()];
  if (bridge) {
    const outs = new Map<string, typeof unique>();
    for (const edge of unique) (outs.get(edge.fromId) ?? outs.set(edge.fromId, []).get(edge.fromId)!).push(edge);
    // From each way into the run, walk through deleted nodes to the nodes it reaches beyond it.
    const exits = (start: string) => {
      const reached = new Set<string>();
      const stack = [start];
      const visited = new Set<string>();
      while (stack.length) {
        const at = stack.pop()!;
        if (visited.has(at)) continue;
        visited.add(at);
        for (const edge of outs.get(at) ?? []) (gone.has(edge.toId) ? stack.push(edge.toId) : reached.add(edge.toId));
      }
      return reached;
    };
    const made = new Set<string>();
    for (const way of unique.filter((edge) => !gone.has(edge.fromId) && gone.has(edge.toId))) {
      for (const target of exits(way.toId)) {
        const pair = `${way.fromId}>${target}`;
        if (made.has(pair) || target === way.fromId) continue;
        made.add(pair);
        if (tx.select({ id: s.graphEdges.id }).from(s.graphEdges).where(and(eq(s.graphEdges.fromId, way.fromId), eq(s.graphEdges.toId, target))).get()) continue;
        record.made('graph_edges', tx.insert(s.graphEdges).values({ projectId, fromId: way.fromId, toId: target, label: way.label, origin: 'human' }).returning().get().id);
      }
    }
  }
  record.removed('graph_edges', 'id', unique.map((edge) => edge.id));
  record.removed('graph_nodes', 'id', [...gone]);
  // The nodes' lines of the graph go with them (foreign keys).
  for (const slice of inChunks([...gone], (part) => [part])) tx.delete(s.graphNodes).where(inArray(s.graphNodes.id, slice)).run();
}

const EVIDENCE_TABLES = [['characters', s.characters], ['relationships', s.relationships], ['documents', s.documents], ['story_events', s.storyEvents], ['speech_rules', s.speechRules]] as const;

/**
 * Inside an edit: removes lines with everything that hangs from them, each recorded so the undo brings it back: their
 * texts (candidates), tags, history (line_events) and run items (which name their line without a foreign key). Deleted
 * lines are evidence of nothing, so their keys come off every knowledge item.
 */
function removeLines(tx: Tx, record: UndoRecorder, projectId: string, unitIds: string[]) {
  if (!unitIds.length) return;
  const keys = new Set(inChunks(unitIds, (slice) => tx.select({ key: s.units.key }).from(s.units).where(inArray(s.units.id, slice)).all()).map((row) => row.key));
  record.removed('units', 'id', unitIds);
  record.removed('candidates', 'unit_id', unitIds);
  record.removed('unit_tags', 'unit_id', unitIds);
  record.removed('line_events', 'unit_id', unitIds);
  record.removed('run_items', 'subject_id', unitIds);
  for (const slice of inChunks(unitIds, (part) => [part])) tx.delete(s.runItems).where(inArray(s.runItems.subjectId, slice)).run();
  for (const slice of inChunks(unitIds, (part) => [part])) tx.delete(s.units).where(inArray(s.units.id, slice)).run();
  for (const [name, table] of EVIDENCE_TABLES) {
    for (const item of tx.select({ id: table.id, evidence: table.evidence }).from(table).where(eq(table.projectId, projectId)).all()) {
      const evidence = item.evidence.filter((key) => !keys.has(key));
      if (evidence.length === item.evidence.length) continue;
      record.rewritten(name, item.id, ['evidence']);
      tx.update(table).set({ evidence }).where(eq(table.id, item.id)).run();
    }
  }
}

/**
 * Inside an edit, the one way lines leave the project: the lines go (removeLines); a node that keeps other lines
 * stays with them, a node left without any is removed like deleteNodes does (with `bridge` the way through it is kept).
 */
function removeLinesAndEmptied(tx: Tx, record: UndoRecorder, projectId: string, unitIds: string[], bridge: boolean) {
  const gone = new Set(unitIds);
  const holders = tx.select().from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().filter((node) => node.unitIds.some((id) => gone.has(id)));
  const emptied = holders.filter((node) => node.unitIds.every((id) => gone.has(id)));
  if (emptied.length) removeNodes(tx, record, projectId, emptied, bridge);
  for (const node of holders) {
    if (emptied.includes(node)) continue;
    record.rewritten('graph_nodes', node.id, ['unit_ids']);
    tx.update(s.graphNodes).set({ unitIds: node.unitIds.filter((id) => !gone.has(id)) }).where(eq(s.graphNodes.id, node.id)).run();
  }
  removeLines(tx, record, projectId, unitIds);
  return { nodes: emptied.length };
}

/** Deletes nodes and their lines (see removeNodes for `bridge`); the lines stop being evidence of knowledge items. */
export function deleteNodes(db: Db, projectId: string, ids: string[], bridge = true) {
  const nodes = inChunks(ids, (slice) => db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), inArray(s.graphNodes.id, slice))).all());
  if (!nodes.length) badRequest('지울 노드가 없습니다.');
  const unitIds = nodes.flatMap((node) => node.unitIds);
  refuseBusy(db, projectId, unitIds);
  return edit(db, projectId, 'script', (tx, record) => {
    removeNodes(tx, record, projectId, nodes, bridge);
    removeLines(tx, record, projectId, unitIds);
    return { deleted: nodes.length, lines: unitIds.length };
  });
}

/**
 * Deletes lines, whichever way they are named (the script's list, the graph, the agent's delete_lines): only these
 * lines go, with their texts, tags, history and run items. A node that keeps other lines stays with them; a node left
 * without any is removed (with `bridge` the way through it is kept). The lines stop being evidence of knowledge
 * items. Lines an active or paused run uses are refused.
 */
export function deleteLines(db: Db, projectId: string, unitIds: string[], bridge = true) {
  const ids = [...new Set(unitIds)];
  const units = inChunks(ids, (slice) => db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).all());
  if (!units.length || units.length !== ids.length) badRequest('지울 대사를 찾을 수 없습니다.');
  refuseBusy(db, projectId, ids);
  return edit(db, projectId, 'script', (tx, record) => ({ deleted: ids.length, ...removeLinesAndEmptied(tx, record, projectId, ids, bridge) }));
}

/** Deletes a scene, document group or UI group with all of its lines, which go as deleteLines removes them. */
export function deleteGroup(db: Db, projectId: string, groupId: string) {
  found(db.select({ id: s.groups.id }).from(s.groups).where(and(eq(s.groups.id, groupId), eq(s.groups.projectId, projectId))).get(), '묶음');
  const ids = db.select({ id: s.units.id }).from(s.units).where(eq(s.units.groupId, groupId)).all().map((row) => row.id);
  refuseBusy(db, projectId, ids);
  return edit(db, projectId, 'scenes', (tx, record) => {
    removeLinesAndEmptied(tx, record, projectId, ids, true);
    // Nodes without lines that stood in the scene (a hub, a choice) stay in the graph, in no scene.
    for (const node of tx.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.groupId, groupId))).all()) {
      record.rewritten('graph_nodes', node.id, ['group_id']);
      tx.update(s.graphNodes).set({ groupId: null }).where(eq(s.graphNodes.id, node.id)).run();
    }
    record.removed('groups', 'id', [groupId]);
    tx.delete(s.groups).where(eq(s.groups.id, groupId)).run();
    return { deleted: ids.length };
  });
}

/** A line by its key, for the tools that name lines so. */
export function unitByKey(db: Db, projectId: string, key: string) {
  const unit = db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get();
  if (!unit) badRequest(`없는 대사 키입니다: ${key}`);
  return unit!.id;
}

/**
 * Copies of nodes: each copy has a copy of its lines (same text, speaker and listener, a new key,
 * no translation yet) at the end of the original's scene, and the lines between the copied nodes are
 * copied with them. Nothing outside the copies is connected to them. Returns old node id → new.
 */
export function duplicateNodes(db: Db, projectId: string, ids: string[]) {
  const nodes = inChunks(ids, (slice) => db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), inArray(s.graphNodes.id, slice))).all());
  if (!nodes.length) badRequest('복사할 노드가 없습니다.');
  return edit(db, projectId, 'script', (tx, record) => {
    const made = new Map<string, string>();
    // In script order, so the copies read in the order of their originals.
    const seqOf = new Map(inChunks(nodes.flatMap((node) => node.unitIds), (slice) => tx.select({ id: s.units.id, seq: s.units.seq }).from(s.units).where(inArray(s.units.id, slice)).all()).map((row) => [row.id, row.seq]));
    const first = (node: (typeof nodes)[number]) => Math.min(...node.unitIds.map((id) => seqOf.get(id) ?? Infinity));
    for (const node of [...nodes].sort((a, b) => first(a) - first(b))) {
      const lines = node.unitIds.length ? tx.select().from(s.units).where(inArray(s.units.id, node.unitIds)).all() : [];
      const copies: string[] = [];
      for (const line of node.unitIds.map((id) => lines.find((row) => row.id === id)).filter((row) => row !== undefined)) {
        const end = tx.select({ sort: s.units.sort }).from(s.units).where(eq(s.units.groupId, line.groupId)).all().reduce((max, row) => Math.max(max, row.sort), -1) + 1;
        // A copy keeps who its original is said to, as that listener was decided.
        copies.push(insertLine(tx, record, projectId, { groupId: line.groupId, key: `${line.key}-copy-${randomUUID().slice(0, 8)}`, source: line.source, speaker: line.speaker, listener: line.listener, listenerOrigin: line.listenerOrigin, listenerConfidence: line.listenerConfidence, kind: line.kind, sort: end }).id);
      }
      const created = tx.insert(s.graphNodes).values({ projectId, key: `copy-${randomUUID()}`, type: node.type, kind: node.kind, label: node.label, groupId: node.groupId, unitIds: copies, meta: { ...node.meta, manualSourceEntry: true }, origin: 'human' }).returning().get();
      record.made('graph_nodes', created.id);
      made.set(node.id, created.id);
    }
    const inside = inChunks([...made.keys()], (slice) => tx.select().from(s.graphEdges).where(inArray(s.graphEdges.fromId, slice)).all()).filter((edge) => made.has(edge.toId));
    for (const edge of inside) record.made('graph_edges', tx.insert(s.graphEdges).values({ projectId, fromId: made.get(edge.fromId)!, toId: made.get(edge.toId)!, kind: edge.kind, label: edge.label, origin: 'human' }).returning().get().id);
    return { made: Object.fromEntries(made) };
  });
}

/** A scene by id, key or title (as show_graph names scenes); for the AI's tools. */
export function sceneByRef(db: Db, projectId: string, ref: string) {
  const lower = ref.toLowerCase();
  const match = db.select({ id: s.groups.id, title: s.groups.title }).from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.kind, 'scene'))).all()
    .filter((group) => group.id === ref || group.title.toLowerCase() === lower);
  const byKey = match.length ? [] : db.select({ id: s.groups.id, title: s.groups.title }).from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.kind, 'scene'), eq(s.groups.key, ref))).all();
  const hits = match.length ? match : byKey;
  if (!hits.length) badRequest(`찾을 수 없는 장면입니다: ${ref}`);
  if (hits.length > 1) badRequest(`'${ref}'와 일치하는 장면이 여럿입니다. 키나 id로 지정하세요.`);
  return hits[0]!.id;
}

/** The nodes of a scene with the script position (seq) of their first and last line; nodes without lines are left out. */
function sceneNodes(db: Pick<Db, 'select'>, projectId: string, groupId: string) {
  const nodes = db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.groupId, groupId))).all();
  const seqOf = new Map(inChunks(nodes.flatMap((node) => node.unitIds), (slice) => db.select({ id: s.units.id, seq: s.units.seq }).from(s.units).where(inArray(s.units.id, slice)).all()).map((row) => [row.id, row.seq]));
  return nodes.flatMap((node) => {
    const seqs = node.unitIds.map((id) => seqOf.get(id)).filter((seq) => seq !== undefined);
    return seqs.length ? [{ node, first: Math.min(...seqs), last: Math.max(...seqs), head: seqOf.get(node.unitIds[0]!) ?? Math.min(...seqs) }] : [];
  });
}

/**
 * "대본 순서로 잇기": in each scene, nodes in script order (their first line's position) are linked one to
 * the next, but only where the earlier has no line out and the later none in, so existing branches stay as
 * they are. Takes whole scenes (every node) and/or single nodes (those among them, per scene).
 */
export function linkInOrder(db: Db, projectId: string, input: { groupIds?: string[]; nodeIds?: string[]; origin: GraphOrigin }) {
  const scenes = new Set(db.select({ id: s.groups.id }).from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.kind, 'scene'))).all().map((row) => row.id));
  const byScene = new Map<string, Set<string> | 'all'>();
  for (const id of input.groupIds ?? []) if (scenes.has(id)) byScene.set(id, 'all');
  const picked = input.nodeIds?.length ? inChunks(input.nodeIds, (slice) => db.select({ id: s.graphNodes.id, groupId: s.graphNodes.groupId }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), inArray(s.graphNodes.id, slice))).all()) : [];
  for (const node of picked) {
    if (!node.groupId || !scenes.has(node.groupId) || byScene.get(node.groupId) === 'all') continue;
    const set = byScene.get(node.groupId) as Set<string> | undefined;
    if (set) set.add(node.id);
    else byScene.set(node.groupId, new Set([node.id]));
  }
  if (!byScene.size) badRequest('이을 장면이나 노드가 없습니다.');
  const edges = db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const hasOut = new Set(edges.map((edge) => edge.fromId));
  const hasIn = new Set(edges.map((edge) => edge.toId));
  const pairs: [string, string][] = [];
  let skipped = 0;
  for (const [groupId, only] of byScene) {
    const ordered = sceneNodes(db, projectId, groupId).filter(({ node }) => only === 'all' || only.has(node.id)).sort((a, b) => a.head - b.head || a.first - b.first);
    for (let index = 1; index < ordered.length; index++) {
      const [earlier, later] = [ordered[index - 1]!.node.id, ordered[index]!.node.id];
      if (hasOut.has(earlier) || hasIn.has(later)) skipped++;
      else {
        pairs.push([earlier, later]);
        hasOut.add(earlier);
        hasIn.add(later);
      }
    }
  }
  if (!pairs.length) return { linked: 0, skipped, token: null };
  const result = edit(db, projectId, 'script', (tx, record) => {
    for (const [fromId, toId] of pairs) record.made('graph_edges', tx.insert(s.graphEdges).values({ projectId, fromId, toId, origin: input.origin }).returning().get().id);
    return {};
  });
  return { linked: pairs.length, skipped, token: result.token };
}

/** The node that holds a line (by its key), or a node by its own key; for the AI's tools, which name lines by key. */
export function nodeByKey(db: Db, projectId: string, key: string) {
  const unit = db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get();
  if (unit) {
    const holder = db.all<{ id: string }>(sql`select id from graph_nodes where project_id = ${projectId} and exists (select 1 from json_each(unit_ids) where value = ${unit.id}) limit 1`)[0];
    if (holder) return holder.id;
  }
  const node = db.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, key))).get();
  if (!node) badRequest(`대사 그래프에 없는 키입니다: ${key}`);
  return node!.id;
}

/** One line of the graph with its two ends (key, who speaks, the first line), for its pane. */
export function edgeDetail(db: Db, projectId: string, id: string) {
  const edge = found(db.select().from(s.graphEdges).where(and(eq(s.graphEdges.projectId, projectId), eq(s.graphEdges.id, id))).get(), '선');
  const end = (nodeId: string) => {
    const node = db.select().from(s.graphNodes).where(eq(s.graphNodes.id, nodeId)).get()!;
    const first = node.unitIds[0] ? db.select({ key: s.units.key, speaker: s.units.speaker, source: s.units.source }).from(s.units).where(eq(s.units.id, node.unitIds[0])).get() : undefined;
    return { id: node.id, key: first?.key ?? node.key, kind: node.kind, label: node.label, speaker: first?.speaker ?? null, text: first?.source ?? null };
  };
  return { id: edge.id, label: edge.label, origin: edge.origin, from: end(edge.fromId), to: end(edge.toId) };
}
