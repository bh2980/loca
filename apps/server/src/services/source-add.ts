import { eq, sql } from 'drizzle-orm';
import { knowledgeKindScope, TAG_SCOPE_LABELS, templateStatusIds, unitKindOf, withFormats, type AddSourceInput, type KnowledgeTagKind } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { attachUnitTags } from '../domain/tag-scope.ts';
import { setKnowledgeTag } from '../domain/knowledge-tags.ts';
import { Refusal } from '../refusal.ts';
import { diffSource, knowledgeMatch, type SourceDiff } from './source-diff.ts';
import { changed, initialStatus, invalidate, refreshNodeGroups, refuseBusy, resequence } from './source-mutations.ts';
import { setLineStatus } from '../domain/line-save.ts';
import { PERSON, type Saver } from '../domain/saver.ts';
import { recorder } from './undo-records.ts';

/** Colors for tags that came with the file, in turn (as a new project's). */
const TAG_COLORS = ['#0091ad', '#009589', '#6d8e1c', '#8f68cb', '#bc5694', '#6076de'];

export interface SourceAdded {
  added: { groups: number; units: number; graphNodes: number; graphEdges: number };
  /** Keys the project has already and the file gives otherwise: left as the project has them. */
  kept: { groups: number; units: number; graphNodes: number };
  /** The project's lines in the groups the file brought again that the file no longer has: not deleted. */
  missing: number;
  /** The file's knowledge items the project lacked (added, per kind) and those it has (kept as the project has them). */
  knowledge: { added: Record<keyof SourceDiff['knowledge'], number>; kept: number };
  /** The formats turned on in the project's format rules with it (FormatOffer ids). */
  formats: string[];
  /**
   * With `update`: the keys changed to what the file gives (lines, groups, graph nodes), the lines whose source changed and
   * so start over (initial status; their translation stays), and what was not changed with why.
   */
  updated: { units: number; groups: number; graphNodes: number; restarted: number; skipped: { key: string; reason: string }[] };
  /** Tags a knowledge item of the file names that cannot go on it (the tag's places leave its kind out), with why. */
  tagsSkipped: { key: string; reason: string }[];
  /** restore_deleted (kind script) takes back everything this added and changed; null when nothing was. */
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
  // A line's status by name is one of the project's.
  const statusNames = new Set(db.select({ name: s.statuses.name }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().map((row) => row.name));
  const unknownStatus = [...new Set(file.units.filter((unit) => addedUnits.has(unit.key) && unit.status && !statusNames.has(unit.status)).map((unit) => unit.status!))];
  if (unknownStatus.length) return { diff, refusal: `프로젝트에 없는 상태입니다: ${issueList(unknownStatus)}. 상태 이름을 프로젝트의 것으로 바꾸거나 빼세요.` };
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
 * connection. Knowledge items (characters, relationships, speech rules, notes, events, terms) the project lacks go in
 * as a new project's would, matched as diffSource matches them; the ones it has stay as they are. The formats named in `formats` are turned on in the project's format
 * rules, and the undo record puts them back with the rest. One transaction and one undo record (kind script).
 */
/**
 * `via`: who added it, for the 원문 넣기 log (a person on the page, or an accepted add_source); `by`: who a restarted
 * line's status is set by.
 */
export function addSource(db: Db, projectId: string, file: AddSourceInput, via: 'app' | 'proposal' | 'new' = 'app', by: Saver = PERSON): SourceAdded {
  const { diff, refusal } = sourceRefusal(db, projectId, file);
  if (refusal) throw new Refusal('invalid', refusal);
  const changedUnits = file.update ? new Set(diff.units.changed.map((item) => item.key)) : new Set<string>();
  // Lines a running or paused workflow holds keep their input (as any change of a line's source).
  if (changedUnits.size) refuseBusy(db, projectId, db.select({ id: s.units.id, key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all().filter((row) => changedUnits.has(row.key)).map((row) => row.id));
  const updated: SourceAdded['updated'] = { units: 0, groups: 0, graphNodes: 0, restarted: 0, skipped: [] };
  const tagSkips: SourceAdded['tagsSkipped'] = [];
  const addedGroups = new Set(diff.groups.added);
  const addedUnits = new Set(diff.units.added);
  const addedNodes = new Set(diff.graph.nodes.added);
  const groups = file.groups.filter((group) => addedGroups.has(group.key));
  const units = file.units.filter((unit) => addedUnits.has(unit.key));
  const nodes = (file.graph?.nodes ?? []).filter((node) => addedNodes.has(node.key));

  const known = knowledgeMatch(db, projectId, file);
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
    const statusByName = new Map(statuses.map((status) => [status.name, status.id]));
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
        listenerOrigin: unit.listener ? (unit.listenerOrigin ?? 'import') : null,
        listenerConfidence: unit.listener ? (unit.listenerConfidence ?? null) : null,
        source: unit.source,
        translation: unit.translation ?? null,
        candidateId,
        statusId: unit.status ? statusByName.get(unit.status)! : unit.translation ? translatedStatus : startStatus,
        note: unit.note ?? '',
        translate: unit.translate ?? null,
        meta: unit.meta,
      }).returning({ id: s.units.id }).get();
      record.made('units', row.id);
      unitIds.set(unit.key, row.id);
      unitGroup.set(row.id, group.id);
      if (candidateId) record.made('candidates', tx.insert(s.candidates).values({ id: candidateId, unitId: row.id, text: unit.translation!, origin: 'import' }).returning({ id: s.candidates.id }).get().id);
    });

    // Tags by name (the game data's labels, a project file's tags on lines and knowledge): the project's, a missing one made.
    const tagIds = new Map(tx.select({ id: s.tags.id, name: s.tags.name }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().map((tag) => [tag.name, tag.id]));
    let madeTags = 0;
    const tagIdOf = (name: string) => {
      const own = tagIds.get(name);
      if (own) return own;
      const id = tx.insert(s.tags).values({ projectId, name, color: TAG_COLORS[madeTags++ % TAG_COLORS.length] }).returning({ id: s.tags.id }).get().id;
      record.made('tags', id);
      tagIds.set(name, id);
      return id;
    };
    for (const name of new Set(units.flatMap((unit) => unit.tags))) {
      attachUnitTags(tx, projectId, units.filter((unit) => unit.tags.includes(name)).map((unit) => unitIds.get(unit.key)!), { add: [tagIdOf(name)] }, { onMisplaced: 'skip' });
    }

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

    // Knowledge the project lacks, as a new project's would come in; what it has stays as it is.
    const fresh = known.added;
    const tagged: { kind: KnowledgeTagKind; id: string; tags?: string[] }[] = [];
    // What every knowledge item brings besides its words: its standing, where it came from (the file, unless it says), its grounds.
    const standing = (item: { status?: 'candidate' | 'confirmed'; origin?: 'human' | 'ai' | 'import' | 'script'; statusBy?: 'ai' | 'human'; evidence: string[]; reviewNote?: string }) =>
      ({ status: item.status, origin: item.origin ?? 'import', statusBy: item.statusBy, evidence: item.evidence, reviewNote: item.reviewNote }) as const;
    const newCharacterOf = new Map<string, string>();
    for (const index of fresh.characters) {
      const character = file.characters[index]!;
      const { id } = tx.insert(s.characters).values({ projectId, name: character.name, aliases: character.aliases, profile: character.profile, speech: character.speech, style: character.style, player: character.player, color: character.color, gender: character.gender, ageBand: character.ageBand, role: character.role, ...standing(character) }).returning({ id: s.characters.id }).get();
      record.made('characters', id);
      tagged.push({ kind: 'characters', id, tags: character.tags });
      for (const name of [character.name, ...character.aliases]) newCharacterOf.set(name, id);
    }
    // A person by any name: the project's character, a new one, or either by the main name the file gives an alias.
    const idOf = (name: string) => known.characterIdOf.get(name) ?? newCharacterOf.get(name) ?? known.characterIdOf.get(known.person(name)) ?? newCharacterOf.get(known.person(name))!;
    for (const index of fresh.relationships) {
      const rel = file.relationships[index]!;
      const { id } = tx.insert(s.relationships).values({ projectId, fromId: idOf(rel.from), toId: idOf(rel.to), kind: rel.kind, description: rel.description, mutual: rel.mutual, changes: rel.changes, ...standing(rel) }).returning({ id: s.relationships.id }).get();
      record.made('relationships', id);
      tagged.push({ kind: 'relationships', id, tags: rel.tags });
    }
    for (const index of fresh.documents) {
      const doc = file.documents[index]!;
      const { id } = tx.insert(s.documents).values({ projectId, title: doc.title, kind: doc.kind, body: doc.body, alwaysInclude: doc.alwaysInclude, ...standing(doc) }).returning({ id: s.documents.id }).get();
      record.made('documents', id);
      tagged.push({ kind: 'documents', id, tags: doc.tags });
    }
    // Events by title, the project's and the new ones, for the 사건 흐름's lines.
    const eventIds = new Map<string, string>();
    for (const row of tx.select({ id: s.storyEvents.id, title: s.storyEvents.title }).from(s.storyEvents).where(eq(s.storyEvents.projectId, projectId)).all()) if (!eventIds.has(row.title)) eventIds.set(row.title, row.id);
    const newEvents = new Set<string>();
    for (const index of fresh.events) {
      const event = file.events[index]!;
      const { id } = tx.insert(s.storyEvents).values({ projectId, title: event.title, summary: event.summary, cause: event.cause, outcome: event.outcome, participants: event.participants, ...standing(event) }).returning({ id: s.storyEvents.id }).get();
      record.made('story_events', id);
      tagged.push({ kind: 'events', id, tags: event.tags });
      newEvents.add(id);
      if (!eventIds.has(event.title)) eventIds.set(event.title, id);
    }
    // A person's correction to the 사건 흐름 that touches a new event (two events the project has keep their own).
    for (const link of file.eventLinks) {
      const fromId = eventIds.get(link.from)!;
      const toId = eventIds.get(link.to)!;
      if (fromId === toId || (!newEvents.has(fromId) && !newEvents.has(toId))) continue;
      const row = tx.insert(s.eventLinks).values({ projectId, fromId, toId, kind: link.kind, origin: link.origin ?? 'import' }).onConflictDoNothing().returning({ id: s.eventLinks.id }).get();
      if (row) record.made('event_links', row.id);
    }
    for (const index of fresh.speechRules) {
      const rule = file.speechRules[index]!;
      const { id } = tx.insert(s.speechRules).values({ projectId, fromName: rule.from, toName: rule.to, level: rule.level, address: rule.address, note: rule.note, startKey: rule.start ?? null, ...standing(rule) }).returning({ id: s.speechRules.id }).get();
      record.made('speech_rules', id);
      tagged.push({ kind: 'speechRules', id, tags: rule.tags });
    }
    for (const index of fresh.terms) {
      const term = file.terms[index]!;
      const { id } = tx.insert(s.terms).values({ projectId, source: term.source, target: term.target, note: term.note, status: term.status, origin: term.origin ?? 'import', statusBy: term.statusBy, scope: term.scope, matchCase: term.matchCase, targetCandidates: term.targetCandidates }).returning({ id: s.terms.id }).get();
      record.made('terms', id);
      tagged.push({ kind: 'terms', id, tags: term.tags });
    }
    // Their tags, where each tag may go (a tag whose places leave the item out is said, not put on).
    const byTag = new Map<string, { kind: KnowledgeTagKind; name: string; tagId: string; ids: string[] }>();
    for (const item of tagged) {
      for (const name of item.tags ?? []) {
        const tagId = tagIdOf(name);
        const entry = byTag.get(`${item.kind}\u0000${tagId}`) ?? { kind: item.kind, name, tagId, ids: [] };
        entry.ids.push(item.id);
        byTag.set(`${item.kind}\u0000${tagId}`, entry);
      }
    }
    for (const { kind, name, tagId, ids } of byTag.values()) {
      if (setKnowledgeTag(tx, projectId, kind, ids, tagId, true)) tagSkips.push({ key: name, reason: `${TAG_SCOPE_LABELS[knowledgeKindScope(kind)]}에 붙일 수 없는 태그라 ${ids.length}개 항목에 붙이지 않았습니다` });
    }

    if (file.update) {
      // Groups: their words; a group's kind holds its lines' kind, so it is not changed here.
      const changedGroups = new Map(diff.groups.changed.map((item) => [item.key, item.fields]));
      for (const group of file.groups.filter((item) => changedGroups.has(item.key))) {
        const fields = changedGroups.get(group.key)!;
        if (fields.includes('kind')) updated.skipped.push({ key: group.key, reason: '묶음의 종류는 바꾸지 않습니다 (안의 대사 종류가 따라야 함)' });
        const set = { ...(fields.includes('title') && { title: group.title }), ...(fields.includes('description') && { description: group.description ?? '' }), ...(fields.includes('section') && { section: group.section ?? null }) };
        if (!Object.keys(set).length) continue;
        const id = groupOf.get(group.key)!.id;
        record.rewritten('groups', id, ['title', 'description', 'section']);
        tx.update(s.groups).set(set).where(eq(s.groups.id, id)).run();
        updated.groups++;
      }
      // Lines: source, speaker, listener and group as the file gives them.
      const rows = new Map(tx.select().from(s.units).where(eq(s.units.projectId, projectId)).all().filter((row) => changedUnits.has(row.key)).map((row) => [row.key, row]));
      const restart: string[] = [];
      for (const unit of file.units.filter((item) => changedUnits.has(item.key))) {
        const had = rows.get(unit.key)!;
        const group = groupOf.get(unit.group)!;
        const moved = group.id !== had.groupId;
        const set: Partial<typeof s.units.$inferInsert> = {};
        if (unit.source !== had.source) set.source = unit.source;
        if (unit.speaker !== undefined && unit.speaker !== had.speaker) set.speaker = unit.speaker;
        if (unit.listener !== undefined && unit.listener !== had.listener) {
          // What a person decided stays: the file is the game's data, the listener the person's reading of it.
          if (had.listenerOrigin === 'human') updated.skipped.push({ key: unit.key, reason: '사람이 정한 청자는 바꾸지 않습니다' });
          else Object.assign(set, { listener: unit.listener, listenerOrigin: 'import' as const, listenerConfidence: null });
        }
        if (moved) Object.assign(set, { groupId: group.id, kind: unit.kind ?? unitKindOf(group.kind), sort: sortIn(group.id, addedGroups.has(group.key), unit.order, 0) });
        else if (unit.kind && unit.kind !== had.kind) set.kind = unit.kind;
        if (!Object.keys(set).length) continue;
        record.rewritten('units', had.id, ['source', 'speaker', 'listener', 'listener_origin', 'listener_confidence', 'group_id', 'kind', 'sort', 'status_id', 'status_by', 'status_run_id']);
        tx.update(s.units).set(set).where(eq(s.units.id, had.id)).run();
        if (set.source !== undefined) restart.push(had.id);
        updated.units++;
      }
      // A changed source is not translated yet: the line starts over, its translation kept to compare with.
      if (restart.length) setLineStatus(tx, projectId, restart, initialStatus(tx, projectId), { statusBy: by.statusBy });
      updated.restarted = restart.length;
      // Graph nodes: what they are called; which lines they hold is the dialogue graph's to edit.
      const changedNodes = new Map(diff.graph.nodes.changed.map((item) => [item.key, item.fields]));
      for (const node of (file.graph?.nodes ?? []).filter((item) => changedNodes.has(item.key))) {
        const fields = changedNodes.get(node.key)!;
        if (fields.includes('units') || fields.includes('group')) updated.skipped.push({ key: node.key, reason: '노드에 담긴 대사와 장면은 그래프 편집에서 바꿉니다' });
        const set = { ...(fields.includes('label') && { label: node.label ?? null }), ...(fields.includes('type') && { type: node.type ?? null }) };
        if (!Object.keys(set).length) continue;
        const id = nodeIds.get(node.key)!;
        record.rewritten('graph_nodes', id, ['label', 'type']);
        tx.update(s.graphNodes).set(set).where(eq(s.graphNodes.id, id)).run();
        updated.graphNodes++;
      }
    }

    // Node types the file names that the project lacks (what a type is called and drawn as); the project's stay.
    const fileTypes = file.graph?.nodeTypes ?? {};
    const { nodeTypes } = tx.select({ nodeTypes: s.projects.nodeTypes }).from(s.projects).where(eq(s.projects.id, projectId)).get()!;
    const newTypes = Object.keys(fileTypes).filter((type) => !Object.hasOwn(nodeTypes, type));
    if (newTypes.length) {
      record.rewritten('projects', projectId, ['node_types']);
      tx.update(s.projects).set({ nodeTypes: { ...nodeTypes, ...Object.fromEntries(newTypes.map((type) => [type, fileTypes[type]!])) } }).where(eq(s.projects.id, projectId)).run();
    }

    if (file.formats?.length) {
      record.rewritten('projects', projectId, ['format_rules']);
      const { formatRules } = tx.select({ formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get()!;
      tx.update(s.projects).set({ formatRules: withFormats(formatRules, file.formats) }).where(eq(s.projects.id, projectId)).run();
    }

    refreshNodeGroups(tx, projectId);
    resequence(tx, projectId);
    invalidate(tx, projectId);
    const token = record.save('script');
    // The log line: only a file that changed something, with what takes it back.
    if (token) {
      tx.insert(s.sourceImports).values({
        projectId,
        name: file.name ?? null,
        via,
        undoId: token,
        summary: {
          added: { groups: groups.length, units: units.length, graphNodes: nodes.length + loose, graphEdges: edges },
          knowledge: { characters: fresh.characters.length, relationships: fresh.relationships.length, documents: fresh.documents.length, terms: fresh.terms.length, events: fresh.events.length, speechRules: fresh.speechRules.length },
          updated: { units: updated.units, groups: updated.groups, graphNodes: updated.graphNodes, restarted: updated.restarted },
          formats: file.formats ?? [],
        },
      }).run();
    }
    return token;
  });
  if (undoId) changed(db, projectId);
  const kinds = Object.keys(diff.knowledge) as (keyof SourceDiff['knowledge'])[];
  const knowledge = { added: Object.fromEntries(kinds.map((kind) => [kind, diff.knowledge[kind].added])) as SourceAdded['knowledge']['added'], kept: kinds.reduce((sum, kind) => sum + diff.knowledge[kind].existing, 0) };
  return {
    added: { groups: groups.length, units: units.length, graphNodes: nodes.length + loose, graphEdges: edges },
    kept: { groups: diff.groups.changed.length, units: diff.units.changed.length, graphNodes: diff.graph.nodes.changed.length },
    missing: diff.units.missing.length,
    knowledge,
    formats: file.formats ?? [],
    updated,
    tagsSkipped: tagSkips,
    undoId,
  };
}
