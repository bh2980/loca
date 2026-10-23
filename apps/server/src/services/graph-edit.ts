import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { GraphOrigin } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { badRequest, found } from '../http-errors.ts';
import { events } from '../events.ts';
import { changed, initialStatus, invalidate, refreshNodeGroups, refuseBusy, resequence, type Tx } from './source-mutations.ts';

/**
 * Editing the dialogue graph in the app (and by the AI through proposals): drawing and deleting
 * lines, adding a line after a node, deleting nodes (their way through is kept), copying nodes.
 * The project is the source of truth (an import is one way in), so these are ordinary edits; what
 * a person or the AI made carries its origin. Every edit returns a token ⌘/Ctrl+Z puts it back with:
 * the rows it changed or removed, as they were, and the ids it created.
 */

type Row = Record<string, unknown>;
interface Undo {
  projectId: string;
  at: number;
  /** Rows as they were before the edit (changed or removed), put back on undo. */
  put: { units: Row[]; unitTags: Row[]; nodes: Row[]; edges: Row[] };
  /** Rows the edit created, removed on undo. */
  drop: { units: string[]; nodes: string[]; edges: string[] };
}
const undos = new Map<string, Undo>();
const KEEP_MS = 60 * 60 * 1000;
const KEEP_MAX = 200;

/** Records what one edit touches, so undo can put it back. */
function recorder(tx: Tx, projectId: string) {
  const undo: Undo = { projectId, at: Date.now(), put: { units: [], unitTags: [], nodes: [], edges: [] }, drop: { units: [], nodes: [], edges: [] } };
  const seen = new Set<string>();
  const once = (kind: string, id: string) => (seen.has(`${kind}:${id}`) ? false : (seen.add(`${kind}:${id}`), true));
  return {
    undo,
    unit(id: string) {
      if (!once('unit', id)) return;
      const row = tx.select().from(s.units).where(eq(s.units.id, id)).get();
      if (row) undo.put.units.push(row);
      undo.put.unitTags.push(...tx.select().from(s.unitTags).where(eq(s.unitTags.unitId, id)).all());
    },
    node(id: string) {
      if (!once('node', id)) return;
      const row = tx.select().from(s.graphNodes).where(eq(s.graphNodes.id, id)).get();
      if (row) undo.put.nodes.push(row);
    },
    edge(id: string) {
      if (!once('edge', id)) return;
      const row = tx.select().from(s.graphEdges).where(eq(s.graphEdges.id, id)).get();
      if (row) undo.put.edges.push(row);
    },
    created(kind: 'units' | 'nodes' | 'edges', id: string) {
      seen.add(`${kind === 'units' ? 'unit' : kind === 'nodes' ? 'node' : 'edge'}:${id}`);
      undo.drop[kind].push(id);
    },
  };
}
type Recorder = ReturnType<typeof recorder>;

function keep(undo: Undo) {
  const token = randomUUID();
  undos.set(token, undo);
  for (const [key, entry] of undos) if (undos.size > KEEP_MAX || Date.now() - entry.at > KEEP_MS) undos.delete(key);
  return token;
}

/** Runs one edit in a transaction, then lays the graph out again; returns the edit's result and its undo token. */
function edit<T>(db: Db, projectId: string, work: (tx: Tx, record: Recorder) => T): T & { token: string } {
  const result = db.transaction((tx) => {
    const record = recorder(tx, projectId);
    const value = work(tx, record);
    refreshNodeGroups(tx, projectId);
    resequence(tx, projectId);
    invalidate(tx, projectId);
    return { value, undo: record.undo };
  });
  changed(db, projectId);
  return { ...result.value, token: keep(result.undo) };
}

const nodeOf = (db: Pick<Db, 'select'>, projectId: string, id: string) => found(db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.id, id))).get(), '그래프 노드');

/** A line from one node to another (none twice); an existing one is kept as it is. */
export function linkNodes(db: Db, projectId: string, input: { fromId: string; toId: string; label?: string | null; origin: GraphOrigin }) {
  if (input.fromId === input.toId) badRequest('같은 노드끼리는 이을 수 없습니다.');
  nodeOf(db, projectId, input.fromId);
  nodeOf(db, projectId, input.toId);
  const existing = db.select().from(s.graphEdges).where(and(eq(s.graphEdges.fromId, input.fromId), eq(s.graphEdges.toId, input.toId))).get();
  if (existing) return { edge: existing, token: keep({ projectId, at: Date.now(), put: { units: [], unitTags: [], nodes: [], edges: [] }, drop: { units: [], nodes: [], edges: [] } }) };
  return edit(db, projectId, (tx, record) => {
    const edge = tx.insert(s.graphEdges).values({ projectId, fromId: input.fromId, toId: input.toId, label: input.label ?? null, origin: input.origin }).returning().get();
    record.created('edges', edge.id);
    return { edge };
  });
}

/** Deletes lines between nodes. */
export function unlinkEdges(db: Db, projectId: string, ids: string[]) {
  const rows = inChunks(ids, (slice) => db.select({ id: s.graphEdges.id }).from(s.graphEdges).where(and(eq(s.graphEdges.projectId, projectId), inArray(s.graphEdges.id, slice))).all());
  if (!rows.length) badRequest('지울 선이 없습니다.');
  return edit(db, projectId, (tx, record) => {
    for (const { id } of rows) {
      record.edge(id);
      tx.delete(s.graphEdges).where(eq(s.graphEdges.id, id)).run();
    }
    return { deleted: rows.length };
  });
}

/**
 * A new line right after a node, in that node's scene: when the node has one way on (A → B; links to
 * hubs do not count) the new line goes between them (A → new → B, the way's label stays on A's side); when it has none or
 * several (a branch) the new line is another way out of A.
 */
export function insertLineAfter(db: Db, projectId: string, nodeId: string, input: { source: string; speaker?: string | null; listener?: string | null; key?: string; origin: GraphOrigin }) {
  const node = nodeOf(db, projectId, nodeId);
  const units = node.unitIds.length ? db.select().from(s.units).where(inArray(s.units.id, node.unitIds)).all() : [];
  const last = units.sort((a, b) => b.sort - a.sort)[0];
  const groupId = last?.groupId ?? node.groupId;
  if (!groupId) badRequest('장면에 속하지 않은 노드 뒤에는 대사를 넣을 수 없습니다.');
  const group = found(db.select().from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.id, groupId!))).get(), '장면');
  if (group.kind !== 'scene') badRequest('대사 그래프에는 장면의 대사만 넣을 수 있습니다.');
  const source = input.source.trim();
  if (!source) badRequest('원문을 입력하세요.');
  const key = input.key?.trim() || `entry-${randomUUID()}`;
  if (db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get()) badRequest(`이미 사용 중인 키입니다: ${key}`);
  return edit(db, projectId, (tx, record) => {
    // Its place in the scene's order: right after the node's last line (later lines move down one).
    const sort = last ? last.sort + 1 : (tx.select({ sort: s.units.sort }).from(s.units).where(eq(s.units.groupId, group.id)).all().reduce((max, row) => Math.max(max, row.sort), -1) + 1);
    for (const later of tx.select({ id: s.units.id, sort: s.units.sort }).from(s.units).where(and(eq(s.units.groupId, group.id), gt(s.units.sort, sort - 1))).all()) {
      record.unit(later.id);
      tx.update(s.units).set({ sort: later.sort + 1 }).where(eq(s.units.id, later.id)).run();
    }
    const unit = tx
      .insert(s.units)
      .values({ projectId, groupId: group.id, key, source, speaker: input.speaker?.trim() || null, listener: input.listener?.trim() || null, kind: 'dialogue', statusId: initialStatus(tx, projectId), sort, ...(input.listener?.trim() && { listenerOrigin: 'human' as const }) })
      .returning()
      .get();
    record.created('units', unit.id);
    const created = tx.insert(s.graphNodes).values({ projectId, key: `entry-${unit.id}`, kind: 'script', groupId: group.id, unitIds: [unit.id], meta: { manualSourceEntry: true }, origin: input.origin }).returning().get();
    record.created('nodes', created.id);
    // Its ways on, leaving out links to hubs (connector nodes that tie many lines to a state): those are not the next line.
    const hubs = new Set(tx.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.kind, 'connector'))).all().map((row) => row.id));
    const outs = tx.select().from(s.graphEdges).where(eq(s.graphEdges.fromId, node.id)).all().filter((edge) => !hubs.has(edge.toId));
    const link = (fromId: string, toId: string, label: string | null) => record.created('edges', tx.insert(s.graphEdges).values({ projectId, fromId, toId, label, origin: input.origin }).returning().get().id);
    if (outs.length === 1) {
      const [way] = outs;
      record.edge(way!.id);
      tx.delete(s.graphEdges).where(eq(s.graphEdges.id, way!.id)).run();
      link(node.id, created.id, way!.label);
      link(created.id, way!.toId, null);
    } else link(node.id, created.id, null);
    return { unitId: unit.id, nodeId: created.id };
  });
}

/**
 * Deletes nodes and their lines. With `bridge`, the way through them is kept: whatever led into
 * the deleted run now leads to whatever it led to (A → B → C, B deleted: A → C), with the label
 * the way in had. A choice deleted without `bridge` takes its option away.
 */
export function deleteNodes(db: Db, projectId: string, ids: string[], bridge = true) {
  const nodes = inChunks(ids, (slice) => db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), inArray(s.graphNodes.id, slice))).all());
  if (!nodes.length) badRequest('지울 노드가 없습니다.');
  const gone = new Set(nodes.map((node) => node.id));
  const unitIds = nodes.flatMap((node) => node.unitIds);
  refuseBusy(db, projectId, unitIds);
  const result = edit(db, projectId, (tx, record) => {
    const touching = inChunks([...gone], (slice) => tx.select().from(s.graphEdges).where(or(inArray(s.graphEdges.fromId, slice), inArray(s.graphEdges.toId, slice))).all());
    const unique = [...new Map(touching.map((edge) => [edge.id, edge])).values()];
    if (bridge) {
      const outs = new Map<string, typeof unique>();
      for (const edge of unique) (outs.get(edge.fromId) ?? outs.set(edge.fromId, []).get(edge.fromId)!).push(edge);
      // From each way into the run, walk through deleted nodes to the nodes it reaches beyond it.
      const exits = (start: string) => {
        const found = new Set<string>();
        const stack = [start];
        const visited = new Set<string>();
        while (stack.length) {
          const at = stack.pop()!;
          if (visited.has(at)) continue;
          visited.add(at);
          for (const edge of outs.get(at) ?? []) (gone.has(edge.toId) ? stack.push(edge.toId) : found.add(edge.toId));
        }
        return found;
      };
      const made = new Set<string>();
      for (const way of unique.filter((edge) => !gone.has(edge.fromId) && gone.has(edge.toId))) {
        for (const target of exits(way.toId)) {
          const pair = `${way.fromId}>${target}`;
          if (made.has(pair) || target === way.fromId) continue;
          made.add(pair);
          if (tx.select({ id: s.graphEdges.id }).from(s.graphEdges).where(and(eq(s.graphEdges.fromId, way.fromId), eq(s.graphEdges.toId, target))).get()) continue;
          record.created('edges', tx.insert(s.graphEdges).values({ projectId, fromId: way.fromId, toId: target, label: way.label, origin: 'human' }).returning().get().id);
        }
      }
    }
    for (const edge of unique) record.edge(edge.id);
    for (const node of nodes) record.node(node.id);
    for (const id of unitIds) record.unit(id);
    // Run items name their line without a foreign key: they go with it (as when a line is deleted elsewhere).
    if (unitIds.length) {
      for (const slice of inChunks(unitIds, (part) => [part])) tx.delete(s.runItems).where(inArray(s.runItems.subjectId, slice)).run();
      for (const slice of inChunks(unitIds, (part) => [part])) tx.delete(s.units).where(inArray(s.units.id, slice)).run();
    }
    // The nodes' lines go with them (foreign keys).
    for (const slice of inChunks([...gone], (part) => [part])) tx.delete(s.graphNodes).where(inArray(s.graphNodes.id, slice)).run();
    return { deleted: nodes.length, lines: unitIds.length };
  });
  events.changed(projectId, 'runs');
  return result;
}

/**
 * Copies of nodes: each copy has a copy of its lines (same text, speaker and listener, a new key,
 * no translation yet) at the end of the original's scene, and the lines between the copied nodes are
 * copied with them. Nothing outside the copies is connected to them. Returns old node id → new.
 */
export function duplicateNodes(db: Db, projectId: string, ids: string[]) {
  const nodes = inChunks(ids, (slice) => db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), inArray(s.graphNodes.id, slice))).all());
  if (!nodes.length) badRequest('복사할 노드가 없습니다.');
  return edit(db, projectId, (tx, record) => {
    const made = new Map<string, string>();
    const status = initialStatus(tx, projectId);
    // In script order, so the copies read in the order of their originals.
    const seqOf = new Map(inChunks(nodes.flatMap((node) => node.unitIds), (slice) => tx.select({ id: s.units.id, seq: s.units.seq }).from(s.units).where(inArray(s.units.id, slice)).all()).map((row) => [row.id, row.seq]));
    const first = (node: (typeof nodes)[number]) => Math.min(...node.unitIds.map((id) => seqOf.get(id) ?? Infinity));
    for (const node of [...nodes].sort((a, b) => first(a) - first(b))) {
      const lines = node.unitIds.length ? tx.select().from(s.units).where(inArray(s.units.id, node.unitIds)).all() : [];
      const copies: string[] = [];
      for (const line of node.unitIds.map((id) => lines.find((row) => row.id === id)).filter((row) => row !== undefined)) {
        const end = tx.select({ sort: s.units.sort }).from(s.units).where(eq(s.units.groupId, line.groupId)).all().reduce((max, row) => Math.max(max, row.sort), -1) + 1;
        const copy = tx
          .insert(s.units)
          .values({ projectId, groupId: line.groupId, key: `${line.key}-copy-${randomUUID().slice(0, 8)}`, source: line.source, speaker: line.speaker, listener: line.listener, listenerOrigin: line.listenerOrigin, kind: line.kind, statusId: status, sort: end })
          .returning()
          .get();
        record.created('units', copy.id);
        copies.push(copy.id);
      }
      const created = tx.insert(s.graphNodes).values({ projectId, key: `copy-${randomUUID()}`, type: node.type, kind: node.kind, label: node.label, groupId: node.groupId, unitIds: copies, meta: { ...node.meta, manualSourceEntry: true }, origin: 'human' }).returning().get();
      record.created('nodes', created.id);
      made.set(node.id, created.id);
    }
    const inside = inChunks([...made.keys()], (slice) => tx.select().from(s.graphEdges).where(inArray(s.graphEdges.fromId, slice)).all()).filter((edge) => made.has(edge.toId));
    for (const edge of inside) record.created('edges', tx.insert(s.graphEdges).values({ projectId, fromId: made.get(edge.fromId)!, toId: made.get(edge.toId)!, kind: edge.kind, label: edge.label, origin: 'human' }).returning().get().id);
    return { made: Object.fromEntries(made) };
  });
}

const nothingChanged = (projectId: string) => keep({ projectId, at: Date.now(), put: { units: [], unitTags: [], nodes: [], edges: [] }, drop: { units: [], nodes: [], edges: [] } });

const sceneOf = (db: Pick<Db, 'select'>, projectId: string, id: string) => {
  const group = found(db.select().from(s.groups).where(and(eq(s.groups.projectId, projectId), eq(s.groups.id, id))).get(), '장면');
  if (group.kind !== 'scene') badRequest(`장면이 아닙니다: ${group.title}`);
  return group;
};

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
 * Connects scene A to scene B in the dialogue graph, which is where scene connections come from:
 * one line from the node holding A's last line to the node holding B's first line. Already there: nothing changes.
 */
export function linkScenes(db: Db, projectId: string, input: { fromGroupId: string; toGroupId: string; origin: GraphOrigin }) {
  if (input.fromGroupId === input.toGroupId) badRequest('같은 장면끼리는 이을 수 없습니다.');
  const from = sceneOf(db, projectId, input.fromGroupId);
  const to = sceneOf(db, projectId, input.toGroupId);
  const last = sceneNodes(db, projectId, from.id).sort((a, b) => b.last - a.last)[0];
  const first = sceneNodes(db, projectId, to.id).sort((a, b) => a.first - b.first)[0];
  if (!last) badRequest(`'${from.title}'에는 대사 그래프 노드가 없습니다.`);
  if (!first) badRequest(`'${to.title}'에는 대사 그래프 노드가 없습니다.`);
  const existing = db.select().from(s.graphEdges).where(and(eq(s.graphEdges.fromId, last!.node.id), eq(s.graphEdges.toId, first!.node.id))).get();
  if (existing) return { edge: existing, created: false, message: `'${from.title}'과 '${to.title}'은 이미 이어져 있습니다.`, token: nothingChanged(projectId) };
  const result = linkNodes(db, projectId, { fromId: last!.node.id, toId: first!.node.id, origin: input.origin });
  return { ...result, created: true, message: `'${from.title}'의 마지막 대사에서 '${to.title}'의 첫 대사로 이었습니다.` };
}

/**
 * Takes the connection from scene A to scene B away: the lines that go straight from a node of A to a node
 * of B. When the connection runs through nodes outside scenes (a choice, a condition) nothing is deleted.
 */
export function unlinkScenes(db: Db, projectId: string, input: { fromGroupId: string; toGroupId: string }) {
  const from = sceneOf(db, projectId, input.fromGroupId);
  const to = sceneOf(db, projectId, input.toGroupId);
  const ids = (groupId: string) => db.select({ id: s.graphNodes.id }).from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.groupId, groupId))).all().map((row) => row.id);
  const [fromIds, toIds] = [new Set(ids(from.id)), new Set(ids(to.id))];
  const direct = db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all().filter((edge) => fromIds.has(edge.fromId) && toIds.has(edge.toId));
  if (!direct.length) return { deleted: 0, message: `'${from.title}'에서 '${to.title}'로 바로 이어진 선이 없습니다. 선택지나 조건 같은 노드를 거쳐 이어진 연결이니, 대사 그래프에서 해당 선을 직접 지워 주세요.`, token: null };
  return { ...unlinkEdges(db, projectId, direct.map((edge) => edge.id)), message: null };
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
  const result = edit(db, projectId, (tx, record) => {
    for (const [fromId, toId] of pairs) record.created('edges', tx.insert(s.graphEdges).values({ projectId, fromId, toId, origin: input.origin }).returning().get().id);
    return {};
  });
  return { linked: pairs.length, skipped, token: result.token };
}

/** Puts back what the edit with this token changed; false when it is no longer kept or the project differs. Once. */
export function undoGraphEdit(db: Db, projectId: string, token: string) {
  const entry = undos.get(token);
  if (!entry || entry.projectId !== projectId) return false;
  undos.delete(token);
  db.transaction((tx) => {
    for (const slice of inChunks(entry.drop.edges, (part) => [part])) tx.delete(s.graphEdges).where(inArray(s.graphEdges.id, slice)).run();
    for (const slice of inChunks(entry.drop.nodes, (part) => [part])) tx.delete(s.graphNodes).where(inArray(s.graphNodes.id, slice)).run();
    for (const slice of inChunks(entry.drop.units, (part) => [part])) {
      tx.delete(s.runItems).where(inArray(s.runItems.subjectId, slice)).run();
      tx.delete(s.units).where(inArray(s.units.id, slice)).run();
    }
    // Lines before the nodes that hold them, nodes before the lines between them.
    for (const row of entry.put.units) tx.insert(s.units).values(row as never).onConflictDoUpdate({ target: s.units.id, set: row as never }).run();
    for (const row of entry.put.unitTags) tx.insert(s.unitTags).values(row as never).onConflictDoNothing().run();
    for (const row of entry.put.nodes) tx.insert(s.graphNodes).values(row as never).onConflictDoUpdate({ target: s.graphNodes.id, set: row as never }).run();
    for (const row of entry.put.edges) tx.insert(s.graphEdges).values(row as never).onConflictDoNothing().run();
    refreshNodeGroups(tx, projectId);
    resequence(tx, projectId);
    invalidate(tx, projectId);
  });
  changed(db, projectId);
  events.changed(projectId, 'runs');
  return true;
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
