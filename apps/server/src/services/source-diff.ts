import { eq } from 'drizzle-orm';
import { FILE_REFERENCE_LABELS, newFormats, unresolvedReferences, type FileReferenceKind, type FormatOffer, type SourceFile } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { Refusal } from '../refusal.ts';

/** A key both have, with the fields the file gives differently from the project. */
export interface KeyChange {
  key: string;
  fields: string[];
}

/** Keys of one kind: in the file only (added), in both but different (changed), in both alike (same). */
export interface KeyDiff {
  added: string[];
  changed: KeyChange[];
  same: number;
}

/** Knowledge items told apart by what names them (a character's names, a term's source, a document's title…). */
export interface ItemDiff {
  added: number;
  existing: number;
}

export interface SourceDiff {
  groups: KeyDiff;
  /** missing: the project's lines in the groups the file brings again that the file no longer has. */
  units: KeyDiff & { missing: string[] };
  /** own: the new scene lines no new node of the file holds, each of which gets a node of its own. */
  graph: { nodes: KeyDiff & { own: number }; edges: { added: number; same: number } };
  /** The formats the new lines use that the project's format rules do not keep. */
  formats: FormatOffer[];
  knowledge: Record<'characters' | 'relationships' | 'documents' | 'terms' | 'events' | 'speechRules', ItemDiff>;
  /** Keys and names the file points at that neither it nor the project has: the file cannot go in as it is. */
  unresolved: { path: string; message: string }[];
  warnings: string[];
}

/** Fields the file gives: an optional one left out is not a difference. */
function changedFields(pairs: Record<string, [file: unknown, project: unknown]>): string[] {
  return Object.entries(pairs)
    .filter(([, [file, project]]) => file !== undefined && JSON.stringify(file) !== JSON.stringify(project ?? null))
    .map(([field]) => field);
}

function keyDiff<T extends { key: string }>(items: T[], change: (item: T) => string[] | null): KeyDiff {
  const diff: KeyDiff = { added: [], changed: [], same: 0 };
  for (const item of items) {
    const fields = change(item);
    if (!fields) diff.added.push(item.key);
    else if (fields.length) diff.changed.push({ key: item.key, fields });
    else diff.same++;
  }
  return diff;
}

/**
 * What adding `file` to the project would do, matched by key (원문 비교; the database is not touched): its
 * groups, lines and graph nodes that are new, changed or the same, the project's lines it no longer has in
 * the groups it brings again, which knowledge items are new, and the references nothing has.
 */
export function diffSource(db: Db, projectId: string, file: SourceFile): SourceDiff {
  const project = db.select({ sourceLanguage: s.projects.sourceLanguage, targetLanguage: s.projects.targetLanguage, formatRules: s.projects.formatRules }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) throw new Refusal('missing', '프로젝트가 없습니다.');

  const groups = db.select({ id: s.groups.id, key: s.groups.key, kind: s.groups.kind, title: s.groups.title, description: s.groups.description, section: s.groups.section }).from(s.groups).where(eq(s.groups.projectId, projectId)).all();
  const units = db.select({ id: s.units.id, key: s.units.key, groupId: s.units.groupId, kind: s.units.kind, speaker: s.units.speaker, listener: s.units.listener, source: s.units.source }).from(s.units).where(eq(s.units.projectId, projectId)).all();
  const nodes = db.select({ id: s.graphNodes.id, key: s.graphNodes.key, type: s.graphNodes.type, label: s.graphNodes.label, groupId: s.graphNodes.groupId, unitIds: s.graphNodes.unitIds }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all();
  const edges = db.select({ fromId: s.graphEdges.fromId, toId: s.graphEdges.toId }).from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all();
  const characters = db.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();

  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  const groupKeyOf = new Map(groups.map((group) => [group.id, group.key]));
  const unitByKey = new Map(units.map((unit) => [unit.key, unit]));
  const unitKeyOf = new Map(units.map((unit) => [unit.id, unit.key]));
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const nodeKeyOf = new Map(nodes.map((node) => [node.id, node.key]));
  // A character by any of its names, as the project's relationships and the file's give them.
  const characterOf = new Map(characters.flatMap((character) => [character.name, ...character.aliases].map((name) => [name, character.name] as const)));

  const known: Record<FileReferenceKind, Set<string>> = {
    group: new Set(groupByKey.keys()),
    unit: new Set(unitByKey.keys()),
    node: new Set(nodeByKey.keys()),
    character: new Set(characterOf.keys()),
  };
  const unresolved = unresolvedReferences(file, known).map((ref) => ({ path: ref.path.join('.'), message: `프로젝트에도 파일에도 없는 ${FILE_REFERENCE_LABELS[ref.to]}: ${ref.key}` }));

  const groupDiff = keyDiff(file.groups, (group) => {
    const had = groupByKey.get(group.key);
    return had ? changedFields({ kind: [group.kind, had.kind], title: [group.title, had.title], description: [group.description, had.description], section: [group.section, had.section] }) : null;
  });

  const unitDiff = keyDiff(file.units, (unit) => {
    const had = unitByKey.get(unit.key);
    if (!had) return null;
    return changedFields({ group: [unit.group, groupKeyOf.get(had.groupId)], kind: [unit.kind, had.kind], speaker: [unit.speaker, had.speaker], listener: [unit.listener, had.listener], source: [unit.source, had.source] });
  });
  const fileUnits = new Set(file.units.map((unit) => unit.key));
  const broughtAgain = new Set(file.groups.flatMap((group) => groupByKey.get(group.key)?.id ?? []));
  const missing = units.filter((unit) => broughtAgain.has(unit.groupId) && !fileUnits.has(unit.key)).map((unit) => unit.key);

  const nodeDiff = keyDiff(file.graph?.nodes ?? [], (node) => {
    const had = nodeByKey.get(node.key);
    if (!had) return null;
    const lines = had.unitIds.map((id) => unitKeyOf.get(id));
    return changedFields({ units: [node.units, lines], type: [node.type, had.type], label: [node.label, had.label], group: [node.group, had.groupId && groupKeyOf.get(had.groupId)] });
  });
  // A connection is one node to another (the graph has none twice).
  const edgeId = (from: string | undefined, to: string | undefined) => `${from}\u0000${to}`;
  const edgeIds = new Set(edges.map((edge) => edgeId(nodeKeyOf.get(edge.fromId), nodeKeyOf.get(edge.toId))));
  const fileEdges = file.graph?.edges ?? [];
  const sameEdges = fileEdges.filter((edge) => edgeIds.has(edgeId(edge.from, edge.to))).length;

  const added = new Set(unitDiff.added);
  const addedUnits = file.units.filter((unit) => added.has(unit.key));
  const fileGroupKind = new Map(file.groups.map((group) => [group.key, group.kind]));
  const held = new Set((file.graph?.nodes ?? []).filter((node) => !nodeByKey.has(node.key)).flatMap((node) => node.units));
  const own = addedUnits.filter((unit) => (groupByKey.get(unit.group)?.kind ?? fileGroupKind.get(unit.group)) === 'scene' && !held.has(unit.key)).length;

  const knowledge = knowledgeDiff(db, projectId, file);

  const warnings: string[] = [];
  if (file.project && file.project.sourceLanguage !== project.sourceLanguage) warnings.push(`파일의 원문 언어(${file.project.sourceLanguage})가 프로젝트(${project.sourceLanguage})와 다릅니다.`);
  if (file.project && file.project.targetLanguage !== project.targetLanguage) warnings.push(`파일의 번역 언어(${file.project.targetLanguage})가 프로젝트(${project.targetLanguage})와 다릅니다.`);

  return {
    groups: groupDiff,
    units: { ...unitDiff, missing },
    graph: { nodes: { ...nodeDiff, own }, edges: { added: fileEdges.length - sameEdges, same: sameEdges } },
    formats: newFormats(addedUnits.map((unit) => unit.source), project.formatRules),
    knowledge,
    unresolved,
    warnings,
  };
}

type KnowledgeKind = keyof SourceDiff['knowledge'];

/**
 * Which of the file's knowledge items the project lacks (their indexes, per kind), each told by what names it: a
 * character by any of its names, a relationship by its two people and kind, a speech rule by its two people and
 * where it starts, a note or an event by its title, a term by its source whatever its case. `characterIdOf` finds a
 * project character by any of its names, `person` a name as the project knows it (else as the file writes it).
 */
export function knowledgeMatch(db: Db, projectId: string, file: SourceFile) {
  const characters = db.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  const characterIdOf = new Map(characters.flatMap((character) => [character.name, ...character.aliases].map((name) => [name, character.id] as const)));
  const characterOf = new Map(characters.flatMap((character) => [character.name, ...character.aliases].map((name) => [name, character.name] as const)));
  const fileCharacterOf = new Map(file.characters.flatMap((character) => [character.name, ...character.aliases].map((name) => [name, character.name] as const)));
  const person = (name: string) => characterOf.get(name) ?? characterOf.get(fileCharacterOf.get(name) ?? '') ?? fileCharacterOf.get(name) ?? name;

  const nameOfId = new Map(characters.map((row) => [row.id, row.name]));
  const relationship = (from: string, to: string, kind: string) => `${from}\u0000${to}\u0000${kind}`;
  const relationships = new Set(
    db.select({ fromId: s.relationships.fromId, toId: s.relationships.toId, kind: s.relationships.kind }).from(s.relationships).where(eq(s.relationships.projectId, projectId)).all()
      .map((row) => relationship(nameOfId.get(row.fromId)!, nameOfId.get(row.toId)!, row.kind)),
  );
  const documents = new Set(db.select({ title: s.documents.title }).from(s.documents).where(eq(s.documents.projectId, projectId)).all().map((row) => row.title));
  const termKey = (source: string) => source.trim().toLowerCase();
  const terms = new Set(db.select({ source: s.terms.source }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((row) => termKey(row.source)));
  const events = new Set(db.select({ title: s.storyEvents.title }).from(s.storyEvents).where(eq(s.storyEvents.projectId, projectId)).all().map((row) => row.title));
  const rule = (from: string, to: string, start: string | null | undefined) => `${from}\u0000${to}\u0000${start ?? ''}`;
  const rules = new Set(db.select({ from: s.speechRules.fromName, to: s.speechRules.toName, start: s.speechRules.startKey }).from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all().map((row) => rule(row.from, row.to, row.start)));

  const fresh = <T,>(items: T[], has: (item: T) => boolean) => items.flatMap((item, index) => (has(item) ? [] : [index]));
  const added: Record<KnowledgeKind, number[]> = {
    characters: fresh(file.characters, (character) => [character.name, ...character.aliases].some((name) => characterOf.has(name))),
    relationships: fresh(file.relationships, (rel) => relationships.has(relationship(person(rel.from), person(rel.to), rel.kind))),
    documents: fresh(file.documents, (doc) => documents.has(doc.title)),
    terms: fresh(file.terms, (term) => terms.has(termKey(term.source))),
    events: fresh(file.events, (event) => events.has(event.title)),
    speechRules: fresh(file.speechRules, (speech) => rules.has(rule(speech.from, speech.to, speech.start))),
  };
  return { added, characterIdOf, person };
}

/** The file's knowledge items the project has already and those it lacks, as counts. */
function knowledgeDiff(db: Db, projectId: string, file: SourceFile): SourceDiff['knowledge'] {
  const { added } = knowledgeMatch(db, projectId, file);
  const count = (kind: KnowledgeKind) => ({ added: added[kind].length, existing: file[kind].length - added[kind].length });
  return { characters: count('characters'), relationships: count('relationships'), documents: count('documents'), terms: count('terms'), events: count('events'), speechRules: count('speechRules') };
}
