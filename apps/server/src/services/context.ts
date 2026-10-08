import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { ContextConfig } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { characters, documents, graphEdges, graphNodes, groups, relationships, terms, units } from '../db/schema.ts';
import { deriveSceneEdges } from './scene-graph.ts';

export interface LineContext {
  key: string;
  speaker: string | null;
  source: string;
  translation: string | null;
}

export interface BatchContext {
  scene: { title: string; description: string } | null;
  previousScenes: { title: string; description: string }[];
  documents: { kind: string; title: string; body: string }[];
  characters: { name: string; aliases: string[]; profile: string }[];
  relationships: { from: string; to: string; kind: string; description: string; mutual: boolean }[];
  terms: { source: string; target: string; note: string }[];
  /** Per unit id: lines that come right before it in the dialogue graph (or scene order), oldest first. */
  preceding: Record<string, LineContext[]>;
}

/** The source graph never changes after import, so its adjacency is built once per project. */
class GraphIndex {
  nodeOfUnit = new Map<string, { nodeId: string; position: number }>();
  unitsOfNode = new Map<string, string[]>();
  incoming = new Map<string, string[]>();
  previousScenes = new Map<string, string[]>();

  constructor(db: Db, projectId: string) {
    const nodes = db.select({ id: graphNodes.id, groupId: graphNodes.groupId, unitIds: graphNodes.unitIds }).from(graphNodes).where(eq(graphNodes.projectId, projectId)).all();
    const edges = db.select({ fromId: graphEdges.fromId, toId: graphEdges.toId }).from(graphEdges).where(eq(graphEdges.projectId, projectId)).all();
    for (const node of nodes) {
      this.unitsOfNode.set(node.id, node.unitIds);
      node.unitIds.forEach((unitId, position) => {
        if (!this.nodeOfUnit.has(unitId)) this.nodeOfUnit.set(unitId, { nodeId: node.id, position });
      });
    }
    for (const edge of edges) {
      const list = this.incoming.get(edge.toId);
      if (list) list.push(edge.fromId);
      else this.incoming.set(edge.toId, [edge.fromId]);
    }
    for (const edge of deriveSceneEdges(nodes, edges)) {
      const list = this.previousScenes.get(edge.to);
      if (list) list.push(edge.from);
      else this.previousScenes.set(edge.to, [edge.from]);
    }
  }

  /** Nearest-first walk backwards. Every branch that leads here counts as "before". */
  precedingUnitIds(unitId: string, limit: number): string[] | null {
    const start = this.nodeOfUnit.get(unitId);
    if (!start) return null;
    const result = this.unitsOfNode.get(start.nodeId)!.slice(0, start.position).reverse();
    const seen = new Set([start.nodeId]);
    const queue = [...(this.incoming.get(start.nodeId) ?? [])];
    while (queue.length && result.length < limit && seen.size < 2000) {
      const nodeId = queue.shift()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      result.push(...[...(this.unitsOfNode.get(nodeId) ?? [])].reverse());
      queue.push(...(this.incoming.get(nodeId) ?? []));
    }
    return result.slice(0, limit);
  }
}

const indexes = new Map<string, GraphIndex>();
const graphIndex = (db: Db, projectId: string) => {
  let index = indexes.get(projectId);
  if (!index) indexes.set(projectId, (index = new GraphIndex(db, projectId)));
  return index;
};
export const forgetProjectContext = (projectId: string) => indexes.delete(projectId);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive match that also works next to Hangul or punctuation. */
const mentions = (text: string, name: string) =>
  name.trim().length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escape(name.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(text);

export function buildContext(
  db: Db,
  projectId: string,
  batch: { id: string; groupId: string; sort: number; speaker: string | null; source: string }[],
  config: ContextConfig,
): BatchContext {
  const index = graphIndex(db, projectId);
  const text = batch.map((unit) => `${unit.speaker ?? ''}\n${unit.source}`).join('\n');
  const groupIds = [...new Set(batch.map((unit) => unit.groupId))];
  const sceneRows = db.select().from(groups).where(inArray(groups.id, groupIds)).all();
  const scene = sceneRows.length === 1 ? { title: sceneRows[0].title, description: sceneRows[0].description } : null;

  let previousScenes: BatchContext['previousScenes'] = [];
  if (config.previousScenes > 0) {
    const ids = [...new Set(groupIds.flatMap((id) => index.previousScenes.get(id) ?? []))].filter((id) => !groupIds.includes(id)).slice(0, config.previousScenes);
    if (ids.length) previousScenes = db.select({ title: groups.title, description: groups.description }).from(groups).where(inArray(groups.id, ids)).all();
  }

  const preceding: BatchContext['preceding'] = {};
  if (config.precedingLines > 0) {
    const wanted = new Map<string, string[]>();
    for (const unit of batch) {
      const fromGraph = index.precedingUnitIds(unit.id, config.precedingLines);
      const ids =
        fromGraph ??
        db
          .select({ id: units.id })
          .from(units)
          .where(and(eq(units.groupId, unit.groupId), lt(units.sort, unit.sort)))
          .orderBy(desc(units.sort))
          .limit(config.precedingLines)
          .all()
          .map((row) => row.id);
      wanted.set(unit.id, ids);
    }
    const all = [...new Set([...wanted.values()].flat())];
    const lines = new Map(
      all.length
        ? db.select({ id: units.id, key: units.key, speaker: units.speaker, source: units.source, translation: units.translation }).from(units).where(inArray(units.id, all)).all().map((row) => [row.id, row])
        : [],
    );
    for (const [unitId, ids] of wanted)
      preceding[unitId] = ids
        .map((id) => lines.get(id))
        .filter((line) => line !== undefined)
        .map(({ key, speaker, source, translation }) => ({ key, speaker, source, translation }))
        .reverse();
  }

  const allCharacters = config.characters || config.relationships ? db.select().from(characters).where(eq(characters.projectId, projectId)).all() : [];
  const present = allCharacters.filter((character) => [character.name, ...character.aliases].some((name) => mentions(text, name)));
  const presentIds = new Set(present.map((character) => character.id));
  const nameOf = new Map(allCharacters.map((character) => [character.id, character.name]));
  const rels = config.relationships
    ? db
        .select()
        .from(relationships)
        .where(eq(relationships.projectId, projectId))
        .all()
        .filter((rel) => presentIds.has(rel.fromId) && presentIds.has(rel.toId))
    : [];

  return {
    scene,
    previousScenes,
    preceding,
    documents: config.documents
      ? db.select({ kind: documents.kind, title: documents.title, body: documents.body }).from(documents).where(and(eq(documents.projectId, projectId), eq(documents.alwaysInclude, true))).all()
      : [],
    characters: config.characters ? present.map(({ name, aliases, profile }) => ({ name, aliases, profile })) : [],
    relationships: rels.map((rel) => ({ from: nameOf.get(rel.fromId)!, to: nameOf.get(rel.toId)!, kind: rel.kind, description: rel.description, mutual: rel.mutual })),
    terms: config.glossary
      ? db
          .select({ source: terms.source, target: terms.target, note: terms.note })
          .from(terms)
          .where(eq(terms.projectId, projectId))
          .all()
          .filter((term) => mentions(text, term.source))
      : [],
  };
}
