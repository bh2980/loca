import {
  DEFAULT_STATUSES,
  defaultWorkflows,
  detectFormatRules,
  type DraftModelChoice,
  type ImportFile,
} from '@tw/shared';
import type { Db } from '../db/index.ts';
import { attachUnitTags } from './tag-scope.ts';

/** Colors for tags that came with the file, in turn. */
const TAG_COLORS = ['#0091ad', '#009589', '#6d8e1c', '#8f68cb', '#bc5694', '#6076de'];
import * as s from '../db/schema.ts';

const CHUNK = 400;
function insertMany<T extends Parameters<Db['insert']>[0]>(tx: Pick<Db, 'insert'>, table: T, rows: T['$inferInsert'][]) {
  for (let index = 0; index < rows.length; index += CHUNK) tx.insert(table).values(rows.slice(index, index + CHUNK)).run();
}

export interface ImportSummary {
  projectId: string;
  groups: number;
  units: number;
  graphNodes: number;
  graphEdges: number;
}

/** Creates a project from a validated standard file. Everything lands in one transaction or nothing does. */
export function importProject(db: Db, file: ImportFile, model: DraftModelChoice = { connectionId: '', model: '' }): ImportSummary {
  const projectId = crypto.randomUUID();
  db.transaction((tx) => {
    const detected = !file.project.formatRules ? detectFormatRules(file.units.map((u) => u.source)) : null;
    const formatRules = file.project.formatRules ?? (detected && detected.recommendedPresets.length > 0 ? { presets: detected.recommendedPresets, custom: [] } : undefined);
    tx.insert(s.projects)
      .values({
        id: projectId,
        name: file.project.name,
        description: file.project.description,
        sourceLanguage: file.project.sourceLanguage,
        targetLanguage: file.project.targetLanguage,
        nodeTypes: file.graph?.nodeTypes ?? {},
        ...(formatRules && { formatRules }),
      })
      .run();

    const statusIds = Object.fromEntries(DEFAULT_STATUSES.map((status) => [status.key, crypto.randomUUID()]));
    insertMany(
      tx,
      s.statuses,
      DEFAULT_STATUSES.map((status, sort) => ({ id: statusIds[status.key], projectId, name: status.name, color: status.color, kind: status.kind, inReview: status.inReview, sort })),
    );

    const groupIds = new Map<string, string>();
    insertMany(
      tx,
      s.groups,
      file.groups.map((group, index) => {
        const id = crypto.randomUUID();
        groupIds.set(group.key, id);
        return { id, projectId, key: group.key, kind: group.kind, title: group.title, description: group.description ?? '', section: group.section ?? null, sort: group.order ?? index, meta: group.meta };
      }),
    );

    const unitIds = new Map<string, string>();
    const unitGroup = new Map<string, string>();
    const unitRows: (typeof s.units.$inferInsert)[] = [];
    const candidateRows: (typeof s.candidates.$inferInsert)[] = [];
    file.units.forEach((unit, index) => {
      const id = crypto.randomUUID();
      const groupId = groupIds.get(unit.group)!;
      unitIds.set(unit.key, id);
      unitGroup.set(id, groupId);
      const candidateId = unit.translation ? crypto.randomUUID() : null;
      if (candidateId) candidateRows.push({ id: candidateId, unitId: id, text: unit.translation!, origin: 'import' });
      unitRows.push({
        id,
        projectId,
        groupId,
        key: unit.key,
        sort: unit.order ?? index,
        kind: unit.kind,
        speaker: unit.speaker ?? null,
        listener: unit.listener ?? null,
        listenerOrigin: unit.listener ? 'import' : null,
        source: unit.source,
        translation: unit.translation ?? null,
        candidateId,
        statusId: unit.translation ? statusIds.draft : statusIds.untranslated,
        meta: unit.meta,
      });
    });
    // seq = position in the whole script: group order, then unit order, tie-broken by group key then unit key.
    const groupOrder = new Map(file.groups.map((group, index) => [group.key, { sort: group.order ?? index, key: group.key }]));
    const groupOfUnit = new Map(file.units.map((unit) => [unit.key, groupOrder.get(unit.group)!]));
    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    unitRows
      .sort((a, b) => {
        const ga = groupOfUnit.get(a.key)!;
        const gb = groupOfUnit.get(b.key)!;
        return ga.sort - gb.sort || compare(ga.key, gb.key) || a.sort - b.sort || compare(a.key, b.key);
      })
      .forEach((row, seq) => {
        row.seq = seq;
      });
    insertMany(tx, s.units, unitRows);
    insertMany(tx, s.candidates, candidateRows);
    // Tags from the game data: one project tag per distinct name.
    const tagNames = [...new Set(file.units.flatMap((unit) => unit.tags))];
    if (tagNames.length) {
      const tagIds = new Map(tagNames.map((name, index) => [name, tx.insert(s.tags).values({ projectId, name, color: TAG_COLORS[index % TAG_COLORS.length] }).returning({ id: s.tags.id }).get().id]));
      const unitsOf = new Map<string, string[]>();
      for (const unit of file.units) for (const name of unit.tags) unitsOf.set(name, [...(unitsOf.get(name) ?? []), unitIds.get(unit.key)!]);
      for (const [name, tagId] of tagIds) attachUnitTags(tx, projectId, unitsOf.get(name) ?? [], { add: [tagId] }, { onMisplaced: 'skip' });
    }

    if (file.graph) {
      const nodeIds = new Map<string, string>();
      insertMany(
        tx,
        s.graphNodes,
        file.graph.nodes.map((node) => {
          const id = crypto.randomUUID();
          nodeIds.set(node.key, id);
          const ids = node.units.map((key) => unitIds.get(key)!);
          const kind = node.kind ?? (node.type ? file.graph!.nodeTypes[node.type]?.kind : undefined) ?? (ids.length ? 'script' : 'unknown');
          return { id, projectId, key: node.key, type: node.type ?? null, kind, label: node.label ?? null, groupId: node.group ? groupIds.get(node.group)! : ids.length ? unitGroup.get(ids[0])! : null, unitIds: ids, meta: node.meta };
        }),
      );
      insertMany(
        tx,
        s.graphEdges,
        file.graph.edges.map((edge) => ({ projectId, fromId: nodeIds.get(edge.from)!, toId: nodeIds.get(edge.to)!, kind: edge.kind ?? null, label: edge.label ?? null })),
      );
    }

    const characterIds = new Map<string, string>();
    insertMany(
      tx,
      s.characters,
      file.characters.map((character) => {
        const id = crypto.randomUUID();
        for (const name of [character.name, ...character.aliases]) characterIds.set(name, id);
        return { id, projectId, name: character.name, aliases: character.aliases, profile: character.profile, speech: character.speech, player: character.player, color: character.color, gender: character.gender, ageBand: character.ageBand, role: character.role, origin: 'import' as const };
      }),
    );
    insertMany(
      tx,
      s.relationships,
      file.relationships.map((rel) => ({
        projectId,
        fromId: characterIds.get(rel.from)!,
        toId: characterIds.get(rel.to)!,
        kind: rel.kind,
        description: rel.description,
        mutual: rel.mutual,
        changes: rel.changes,
        origin: 'import' as const,
      })),
    );
    insertMany(tx, s.documents, file.documents.map((doc) => ({ projectId, ...doc, origin: 'import' as const })));
    insertMany(tx, s.storyEvents, file.events.map((event) => ({ projectId, ...event, origin: 'import' as const })));
    insertMany(
      tx,
      s.speechRules,
      file.speechRules.map((rule) => ({ projectId, fromName: rule.from, toName: rule.to, level: rule.level, address: rule.address, note: rule.note, startKey: rule.start ?? null, origin: 'import' as const })),
    );
    insertMany(tx, s.terms, file.terms.map((term) => ({ projectId, ...term })));

    for (const workflow of defaultWorkflows({ model, untranslated: statusIds.untranslated, draft: statusIds.draft })) tx.insert(s.workflows).values({ projectId, ...workflow }).run();
  });
  return {
    projectId,
    groups: file.groups.length,
    units: file.units.length,
    graphNodes: file.graph?.nodes.length ?? 0,
    graphEdges: file.graph?.edges.length ?? 0,
  };
}
