import { and, eq, sql } from 'drizzle-orm';
import { templateStatusIds, unitKindOf, withFormats, type AddSourceInput } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { attachUnitTags } from '../domain/tag-scope.ts';
import { Refusal } from '../refusal.ts';
import { diffSource, type SourceDiff } from './source-diff.ts';
import { changed, invalidate, refreshNodeGroups, resequence } from './source-mutations.ts';
import { recorder } from './undo-records.ts';

/** Colors for tags that came with the file, in turn (as a new project's). */
const TAG_COLORS = ['#0091ad', '#009589', '#6d8e1c', '#8f68cb', '#bc5694', '#6076de'];

export interface SourceAdded {
  added: { groups: number; units: number; graphNodes: number; graphEdges: number };
  /** Keys the project has already and the file gives otherwise: left as the project has them. */
  kept: { groups: number; units: number; graphNodes: number };
  /** The project's lines in the groups the file brought again that the file no longer has: not deleted. */
  missing: number;
  /** The file's knowledge items (characters, terms…): not added by this. */
  knowledge: number;
  /** The formats turned on in the project's format rules with it (FormatOffer ids). */
  formats: string[];
  /** restore_deleted (kind script) takes back everything this added; null when nothing was added. */
  undoId: string | null;
}

const issueList = (items: string[]) => `${items.slice(0, 5).join(' / ')}${items.length > 5 ? ` 외 ${items.length - 5}개` : ''}`;

/** Why the file cannot go in as it is, or null; the diff of what it would add otherwise. */
export function sourceRefusal(db: Db, projectId: string, file: AddSourceInput): { diff: SourceDiff; refusal: string | null } {
  const diff = diffSource(db, projectId, file);
  if (diff.unresolved.length) return { diff, refusal: `프로젝트에도 파일에도 없는 참조가 ${diff.unresolved.length}개 있습니다: ${issueList(diff.unresolved.map((item) => `${item.path} ${item.message.split(': ').pop()}`))}` };
  // A new node holds lines this file adds: a line the project has already is a node's line there.
  const addedUnits = new Set(diff.units.added);
  const addedNodes = new Set(diff.graph.nodes.added);
  const held = (file.graph?.nodes ?? []).filter((node) => addedNodes.has(node.key)).flatMap((node) => node.units.filter((key) => !addedUnits.has(key)).map((key) => `${node.key} → ${key}`));
  if (held.length) return { diff, refusal: `새 노드가 프로젝트에 이미 있는 대사를 담고 있습니다: ${issueList(held)}. 새 노드에는 이 파일이 더하는 대사만 넣으세요.` };
  // Turning a format on is the person's call: asked whenever the new lines use one the rules lack.
  const offered = new Set(diff.formats.map((format) => format.id));
  if (diff.formats.length && !file.formats) return { diff, refusal: `새 대사에 서식 규칙에 없는 서식이 있습니다: ${diff.formats.map((format) => `${format.id} (${format.examples.slice(0, 3).join(' ')})`).join(', ')}. 서식 규칙에 같이 켤지 사람에게 묻고, 켤 것을 formats에 넣으세요 (켜지 않으면 빈 목록).` };
  const unknown = (file.formats ?? []).filter((id) => !offered.has(id));
  if (unknown.length) return { diff, refusal: `새 대사에 없는 서식이거나 이미 켜져 있습니다: ${unknown.join(', ')}` };
  return { diff, refusal: null };
}

/**
 * Adds to the project what the file has and the project does not, matched by key (원문 더하기): new groups, new
 * lines (into a new group or one the project has), new graph nodes and the connections the project lacks. Nothing
 * the project has is changed or deleted: a key both have stays as the project has it, and a line the file left out
 * stays. A new line without a kind takes its group's, starts in the project's initial status (번역됨 with the translation the
 * file brings, as a candidate), and a new scene line no node of the file holds gets a node of its own with no
 * connection. Knowledge items are not added. The formats named in `formats` are turned on in the project's format
 * rules, and the undo record puts them back with the rest. One transaction and one undo record (kind script).
 */
export function addSource(db: Db, projectId: string, file: AddSourceInput): SourceAdded {
  const { diff, refusal } = sourceRefusal(db, projectId, file);
  if (refusal) throw new Refusal('invalid', refusal);
  const addedGroups = new Set(diff.groups.added);
  const addedUnits = new Set(diff.units.added);
  const addedNodes = new Set(diff.graph.nodes.added);
  const groups = file.groups.filter((group) => addedGroups.has(group.key));
  const units = file.units.filter((unit) => addedUnits.has(unit.key));
  const nodes = (file.graph?.nodes ?? []).filter((node) => addedNodes.has(node.key));

  let edges = 0;
  let loose = 0;
  const undoId = db.transaction((tx) => {
    const record = recorder(tx, projectId);
    const groupRows = tx.select({ id: s.groups.id, key: s.groups.key, kind: s.groups.kind, sort: s.groups.sort }).from(s.groups).where(eq(s.groups.projectId, projectId)).all();
    const groupOf = new Map(groupRows.map((group) => [group.key, group]));
    // After the project's groups, in the file's order.
    const groupBase = Math.max(-1, ...groupRows.map((group) => group.sort)) + 1;
    groups.forEach((group, index) => {
      const row = tx.insert(s.groups).values({ projectId, key: group.key, kind: group.kind, title: group.title, description: group.description ?? '', section: group.section ?? null, sort: groupBase + (group.order ?? index), meta: group.meta }).returning({ id: s.groups.id, key: s.groups.key, kind: s.groups.kind, sort: s.groups.sort }).get();
      record.made('groups', row.id);
      groupOf.set(row.key, row);
    });

    const statuses = tx.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().sort((a, b) => a.sort - b.sort);
    const picked = templateStatusIds(statuses);
    const startStatus = picked.untranslated ?? statuses[0]!.id;
    const translatedStatus = picked.translated ?? startStatus;
    // A line added to a group the project has goes after its lines.
    const nextSort = new Map<string, number>();
    const sortIn = (groupId: string, isNew: boolean, order: number | undefined, index: number) => {
      if (isNew) return order ?? index;
      const next = nextSort.get(groupId) ?? tx.get<{ n: number }>(sql`select coalesce(max(sort), -1) + 1 n from ${s.units} where group_id = ${groupId}`)!.n;
      nextSort.set(groupId, next + 1);
      return next;
    };
    const unitIds = new Map<string, string>();
    const unitGroup = new Map<string, string>();
    units.forEach((unit, index) => {
      const group = groupOf.get(unit.group)!;
      const candidateId = unit.translation ? crypto.randomUUID() : null;
      const row = tx.insert(s.units).values({
        projectId,
        groupId: group.id,
        key: unit.key,
        sort: sortIn(group.id, addedGroups.has(group.key), unit.order, index),
        kind: unit.kind ?? unitKindOf(group.kind),
        speaker: unit.speaker ?? null,
        listener: unit.listener ?? null,
        listenerOrigin: unit.listener ? 'import' : null,
        source: unit.source,
        translation: unit.translation ?? null,
        candidateId,
        statusId: unit.translation ? translatedStatus : startStatus,
        meta: unit.meta,
      }).returning({ id: s.units.id }).get();
      record.made('units', row.id);
      unitIds.set(unit.key, row.id);
      unitGroup.set(row.id, group.id);
      if (candidateId) record.made('candidates', tx.insert(s.candidates).values({ id: candidateId, unitId: row.id, text: unit.translation!, origin: 'import' }).returning({ id: s.candidates.id }).get().id);
    });

    // Tags from the game data: joined to the project's by name, a missing one made.
    const tagNames = [...new Set(units.flatMap((unit) => unit.tags))];
    tagNames.forEach((name, index) => {
      const own = tx.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.projectId, projectId), eq(s.tags.name, name))).get()?.id;
      const tagId = own ?? tx.insert(s.tags).values({ projectId, name, color: TAG_COLORS[index % TAG_COLORS.length] }).returning({ id: s.tags.id }).get().id;
      if (!own) record.made('tags', tagId);
      attachUnitTags(tx, projectId, units.filter((unit) => unit.tags.includes(name)).map((unit) => unitIds.get(unit.key)!), { add: [tagId] }, { onMisplaced: 'skip' });
    });

    const nodeRows = tx.select({ id: s.graphNodes.id, key: s.graphNodes.key }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
    const nodeIds = new Map(nodeRows.map((node) => [node.key, node.id]));
    for (const node of nodes) {
      const ids = node.units.map((key) => unitIds.get(key)!);
      const kind = node.kind ?? (node.type ? file.graph!.nodeTypes[node.type]?.kind : undefined) ?? (ids.length ? 'script' : 'unknown');
      const groupId = node.group ? groupOf.get(node.group)!.id : ids.length ? unitGroup.get(ids[0]!)! : null;
      const row = tx.insert(s.graphNodes).values({ projectId, key: node.key, type: node.type ?? null, kind, label: node.label ?? null, groupId, unitIds: ids, meta: node.meta, origin: 'import' }).returning({ id: s.graphNodes.id }).get();
      record.made('graph_nodes', row.id);
      nodeIds.set(node.key, row.id);
    }
    // A connection the project lacks, between any two nodes (none twice from one node to another).
    const pairs = new Set(tx.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all().map((edge) => `${edge.fromId}\u0000${edge.toId}`));
    for (const edge of file.graph?.edges ?? []) {
      const fromId = nodeIds.get(edge.from)!;
      const toId = nodeIds.get(edge.to)!;
      const pair = `${fromId}\u0000${toId}`;
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      record.made('graph_edges', tx.insert(s.graphEdges).values({ projectId, fromId, toId, kind: edge.kind ?? null, label: edge.label ?? null, origin: 'import' }).returning({ id: s.graphEdges.id }).get().id);
      edges++;
    }

    // Every scene line is a node of the dialogue graph: one of its own for a new line no node holds.
    const placed = new Set(nodes.flatMap((node) => node.units));
    const takenKeys = new Set(nodeIds.keys());
    for (const unit of units) {
      const group = groupOf.get(unit.group)!;
      if (group.kind !== 'scene' || placed.has(unit.key)) continue;
      let key = unit.key;
      for (let n = 2; takenKeys.has(key); n++) key = `${unit.key}#${n}`;
      takenKeys.add(key);
      record.made('graph_nodes', tx.insert(s.graphNodes).values({ projectId, key, kind: 'script', groupId: group.id, unitIds: [unitIds.get(unit.key)!], origin: 'import' }).returning({ id: s.graphNodes.id }).get().id);
      loose++;
    }

    if (file.formats?.length) {
      record.rewritten('projects', projectId, ['format_rules']);
      const { formatRules } = tx.select({ formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()!;
      tx.update(s.projects).set({ formatRules: withFormats(formatRules, file.formats) }).where(eq(s.projects.id, projectId)).run();
    }

    refreshNodeGroups(tx, projectId);
    resequence(tx, projectId);
    invalidate(tx, projectId);
    return record.save('script');
  });
  if (undoId) changed(db, projectId);
  const knowledge = Object.values(diff.knowledge).reduce((sum, item) => sum + item.added + item.existing, 0);
  return {
    added: { groups: groups.length, units: units.length, graphNodes: nodes.length + loose, graphEdges: edges },
    kept: { groups: diff.groups.changed.length, units: diff.units.changed.length, graphNodes: diff.graph.nodes.changed.length },
    missing: diff.units.missing.length,
    knowledge,
    formats: file.formats ?? [],
    undoId,
  };
}
