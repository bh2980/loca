import { asc, eq, ne, and } from 'drizzle-orm';
import { agentSettingsSchema, appliesEverywhere, editorAiSchema, GRAPH_NODE_KINDS, IMPORT_FORMAT, type ImportFileInput, type KnowledgeTagKind } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { workflowRefs } from '../domain/app-defaults.ts';
import { found } from '../refusal.ts';

/** Text the file leaves out when it is empty (an optional field of the format). */
const text = (value: string | null | undefined) => (value ? value : undefined);
/** A knowledge item's or term's standing as the file writes it: only 후보 is said (confirmed is the default; rejected ones are left out). */
const candidate = (status: string) => (status === 'candidate' ? ('candidate' as const) : undefined);
const nodeKind = (kind: string) => ((GRAPH_NODE_KINDS as readonly string[]).includes(kind) ? (kind as (typeof GRAPH_NODE_KINDS)[number]) : 'unknown');

/**
 * 프로젝트 파일로 내보내기: the whole project as one standard file (loca/v1) that makes the same project again (새 프로젝트 ›
 * 파일에서, `loca projects import`): its facts and rules, its statuses, tags and workflows (ids written as names, refs), the
 * script in order with each line's translation, status, tags, memo and 번역 제외 call, the dialogue graph, and the knowledge
 * and terms not rejected (with their tags, where they came from and the 사건 흐름's corrections), and the project's settings
 * (AI 결과 바로 확정, the editor's AI, the automatic tags' names and colours, saved instructions). Not in it: history,
 * candidates, runs, the AI log, chats, the chat's permissions, connections and their keys.
 */
export function exportProject(db: Db, projectId: string): ImportFileInput {
  const project = found(db.select().from(s.projects).where(eq(s.projects.id, projectId)).get(), '프로젝트');

  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).orderBy(asc(s.statuses.sort)).all();
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));
  const tags = db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).orderBy(asc(s.tags.sort), asc(s.tags.name)).all();
  const tagName = new Map(tags.map((tag) => [tag.id, tag.name]));
  const workflows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).orderBy(asc(s.workflows.name)).all();

  const groups = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).orderBy(asc(s.groups.sort), asc(s.groups.key)).all();
  const groupKey = new Map(groups.map((group) => [group.id, group.key]));
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(asc(s.units.seq)).all();
  const unitKey = new Map(units.map((unit) => [unit.id, unit.key]));
  const unitKeys = new Set(unitKey.values());
  const unitTags = new Map<string, string[]>();
  for (const row of db.select({ unitId: s.unitTags.unitId, tagId: s.unitTags.tagId }).from(s.unitTags).innerJoin(s.units, eq(s.units.id, s.unitTags.unitId)).where(eq(s.units.projectId, projectId)).all()) {
    unitTags.set(row.unitId, [...(unitTags.get(row.unitId) ?? []), tagName.get(row.tagId)!]);
  }
  const nodes = db.select().from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).orderBy(asc(s.graphNodes.key)).all();
  const nodeKey = new Map(nodes.map((node) => [node.id, node.key]));
  const edges = db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();

  // Knowledge items' tags by name, per kind and item.
  const itemTags = new Map<string, string[]>();
  for (const row of db.select({ kind: s.knowledgeTags.kind, itemId: s.knowledgeTags.itemId, tagId: s.knowledgeTags.tagId }).from(s.knowledgeTags).innerJoin(s.tags, eq(s.tags.id, s.knowledgeTags.tagId)).where(eq(s.tags.projectId, projectId)).all()) {
    const at = `${row.kind}\u0000${row.itemId}`;
    itemTags.set(at, [...(itemTags.get(at) ?? []), tagName.get(row.tagId)!]);
  }
  const tagsOn = (kind: KnowledgeTagKind, id: string) => itemTags.get(`${kind}\u0000${id}`);
  /** What a knowledge item brings besides its words: its standing, where it came from, its grounds and tags. */
  const facts = (kind: KnowledgeTagKind, item: { id: string; status: string; origin: 'human' | 'ai' | 'import' | 'script'; statusBy: 'ai' | 'human'; evidence: string[]; reviewNote: string }) => ({
    status: candidate(item.status),
    origin: item.origin,
    statusBy: item.statusBy,
    evidence: item.evidence.filter((key) => unitKeys.has(key)),
    reviewNote: text(item.reviewNote),
    tags: tagsOn(kind, item.id),
  });

  const characters = db.select().from(s.characters).where(and(eq(s.characters.projectId, projectId), ne(s.characters.status, 'rejected'))).orderBy(asc(s.characters.name)).all();
  const characterName = new Map(characters.map((character) => [character.id, character.name]));
  const events = db.select().from(s.storyEvents).where(and(eq(s.storyEvents.projectId, projectId), ne(s.storyEvents.status, 'rejected'))).all();
  const eventTitle = new Map(events.map((event) => [event.id, event.title]));
  const eventLinks = db.select().from(s.eventLinks).where(eq(s.eventLinks.projectId, projectId)).all().filter((link) => eventTitle.has(link.fromId) && eventTitle.has(link.toId));
  const editorAi = editorAiSchema.parse(project.editorAi ?? {});
  const relationships = db.select().from(s.relationships).where(and(eq(s.relationships.projectId, projectId), ne(s.relationships.status, 'rejected'))).all().filter((rel) => characterName.has(rel.fromId) && characterName.has(rel.toId));

  return {
    format: IMPORT_FORMAT,
    project: { name: project.name, description: project.description ?? '', sourceLanguage: project.sourceLanguage, targetLanguage: project.targetLanguage, formatRules: project.formatRules, exclusionRules: project.exclusionRules },
    statuses: statuses.map((status) => ({ id: status.id, name: status.name, color: status.color, kind: status.kind, inReview: status.inReview })),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, description: tag.description, scope: tag.scope })),
    workflows: workflows.map((workflow) => ({ id: workflow.id, name: workflow.name, description: workflow.description, definition: workflow.definition, refs: workflowRefs(db, projectId, workflow.definition) })),
    groups: groups.map((group) => ({ key: group.key, kind: group.kind, title: group.title, description: text(group.description), section: text(group.section), order: group.sort, meta: group.meta ?? undefined })),
    units: units.map((unit) => ({
      key: unit.key,
      group: groupKey.get(unit.groupId)!,
      order: unit.sort,
      kind: unit.kind,
      speaker: text(unit.speaker),
      listener: text(unit.listener),
      listenerOrigin: unit.listener && unit.listenerOrigin !== 'import' ? (unit.listenerOrigin ?? undefined) : undefined,
      listenerConfidence: unit.listener ? (unit.listenerConfidence ?? undefined) : undefined,
      source: unit.source,
      translation: unit.translation ?? undefined,
      tags: unitTags.get(unit.id) ?? [],
      status: statusName.get(unit.statusId),
      note: text(unit.note),
      translate: unit.translate ?? undefined,
      meta: unit.meta ?? undefined,
    })),
    graph: {
      nodeTypes: project.nodeTypes,
      nodes: nodes.map((node) => ({ key: node.key, type: text(node.type), kind: nodeKind(node.kind), label: text(node.label), units: node.unitIds.flatMap((id) => unitKey.get(id) ?? []), group: node.groupId ? groupKey.get(node.groupId) : undefined, meta: node.meta ?? undefined })),
      edges: edges.flatMap((edge) => (nodeKey.has(edge.fromId) && nodeKey.has(edge.toId) ? [{ from: nodeKey.get(edge.fromId)!, to: nodeKey.get(edge.toId)!, kind: text(edge.kind), label: text(edge.label) }] : [])),
    },
    characters: characters.map((character) => ({ name: character.name, aliases: character.aliases, profile: character.profile, speech: character.speech, style: Object.keys(character.style).length ? character.style : undefined, player: character.player, color: character.color, gender: character.gender, ageBand: character.ageBand, role: character.role, ...facts('characters', character) })),
    relationships: relationships.map((rel) => ({ from: characterName.get(rel.fromId)!, to: characterName.get(rel.toId)!, kind: rel.kind, description: rel.description, mutual: rel.mutual, changes: rel.changes, ...facts('relationships', rel) })),
    speechRules: db.select().from(s.speechRules).where(and(eq(s.speechRules.projectId, projectId), ne(s.speechRules.status, 'rejected'))).all().map((rule) => ({ from: rule.fromName, to: rule.toName, level: rule.level, address: rule.address, note: rule.note, start: rule.startKey ?? undefined, ...facts('speechRules', rule) })),
    events: events.map((event) => ({ title: event.title, summary: event.summary, cause: event.cause, outcome: event.outcome, participants: event.participants, ...facts('events', event) })),
    eventLinks: eventLinks.map((link) => ({ from: eventTitle.get(link.fromId)!, to: eventTitle.get(link.toId)!, kind: link.kind, origin: link.origin })),
    documents: db.select().from(s.documents).where(and(eq(s.documents.projectId, projectId), ne(s.documents.status, 'rejected'))).orderBy(asc(s.documents.title)).all().map((doc) => ({ title: doc.title, kind: doc.kind, body: doc.body, alwaysInclude: doc.alwaysInclude, ...facts('documents', doc) })),
    terms: db.select().from(s.terms).where(and(eq(s.terms.projectId, projectId), ne(s.terms.status, 'rejected'))).orderBy(asc(s.terms.source)).all().map((term) => ({
      source: term.source,
      target: term.target,
      note: term.note,
      mode: term.mode === 'fixed' ? undefined : term.mode,
      alternatives: term.alternatives.length ? term.alternatives : undefined,
      scope: appliesEverywhere(term.scope) ? undefined : term.scope,
      matchCase: term.matchCase || undefined,
      targetCandidates: term.targetCandidates.length ? term.targetCandidates : undefined,
      status: candidate(term.status),
      origin: term.origin,
      statusBy: term.statusBy,
      tags: tagsOn('terms', term.id),
    })),
    // The project's settings but the chat's permissions (a project made from the file asks as the home says).
    settings: {
      aiAutoConfirm: project.aiAutoConfirm,
      editorAi,
      markStyles: project.markStyles,
      prompts: agentSettingsSchema.parse(project.agentSettings ?? {}).prompts,
      refs: workflowRefs(db, projectId, editorAi),
    },
  };
}
