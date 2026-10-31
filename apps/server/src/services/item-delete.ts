import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { aliasNote } from './terms.ts';

/**
 * Deleting project items, for the app's delete buttons and the agent's delete_items (#45): one
 * place, so both refuse the same things. Rows that point at a deleted item (a character's
 * relationships, a tag's links) go with it through the database's cascades.
 */
export const DELETABLE = {
  characters: { table: s.characters, what: '인물', topic: 'knowledge' },
  relationships: { table: s.relationships, what: '관계', topic: 'knowledge' },
  speechRules: { table: s.speechRules, what: '말투 규칙', topic: 'knowledge' },
  events: { table: s.storyEvents, what: '사건', topic: 'knowledge' },
  eventLinks: { table: s.eventLinks, what: '사건 연결', topic: 'knowledge' },
  documents: { table: s.documents, what: '노트', topic: 'knowledge' },
  terms: { table: s.terms, what: '용어', topic: 'terms' },
  tags: { table: s.tags, what: '태그', topic: 'statuses' },
} as const;
export type DeletableKind = keyof typeof DELETABLE;
export const DELETABLE_KINDS = Object.keys(DELETABLE) as [DeletableKind, ...DeletableKind[]];

/** Which of the ids exist in the project. */
export function deletable(db: DeleteDb, projectId: string, kind: DeletableKind, ids: string[]) {
  const { table } = DELETABLE[kind];
  const rows = inChunks(ids, (slice) => db.select({ id: table.id }).from(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).all());
  const found = new Set(rows.map((row) => row.id));
  return { ids: ids.filter((id) => found.has(id)), missing: ids.filter((id) => !found.has(id)) };
}

/** What a delete removed, kept for a while so ⌘/Ctrl+Z can put it back (this server process only). */
interface Removed {
  projectId: string;
  parts: { kind: DeletableKind; rows: Record<string, unknown>[] }[];
  tags: (typeof s.knowledgeTags.$inferSelect)[];
  unitTags: (typeof s.unitTags.$inferSelect)[];
  at: number;
}
const removed = new Map<string, Removed>();
type DeleteDb = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const KEEP_MS = 60 * 60 * 1000;
const KEEP_MAX = 200;

/**
 * A character's name terms nobody has touched: the candidates saving it wrote (addNameTerms: its name
 * and aliases, note "인물 이름" / "X의 별칭"), still without a translation and with that note, whose
 * spelling no remaining character has. They go with the character (and come back with it).
 */
function untouchedNameTerms(db: DeleteDb, projectId: string, characterIds: string[]) {
  if (!characterIds.length) return [];
  const all = db.select({ id: s.characters.id, name: s.characters.name, aliases: s.characters.aliases }).from(s.characters).where(eq(s.characters.projectId, projectId)).all();
  const gone = new Set(characterIds);
  const kept = new Set(all.filter((row) => !gone.has(row.id)).flatMap((row) => [row.name, ...row.aliases]).map((name) => name.trim().toLowerCase()));
  const notes = new Map<string, Set<string>>();
  for (const row of all.filter((item) => gone.has(item.id)))
    for (const name of [row.name, ...row.aliases]) {
      const spelling = name.trim().toLowerCase();
      if (!spelling || kept.has(spelling)) continue;
      (notes.get(spelling) ?? notes.set(spelling, new Set()).get(spelling)!).add(name.trim().toLowerCase() === row.name.trim().toLowerCase() ? '인물 이름' : aliasNote(row.name.trim()));
    }
  if (!notes.size) return [];
  return db
    .select()
    .from(s.terms)
    .where(and(eq(s.terms.projectId, projectId), eq(s.terms.origin, 'script'), eq(s.terms.status, 'candidate'), eq(s.terms.target, '')))
    .all()
    .filter((term) => notes.get(term.source.trim().toLowerCase())?.has(term.note.trim()));
}

/** Rows of `ids` and what goes with them: a character's relationships and untouched name terms, an event's lines. */
function rowsOf(db: DeleteDb, projectId: string, kind: DeletableKind, ids: string[]) {
  const { table } = DELETABLE[kind];
  const parts = [{ kind, rows: inChunks(ids, (slice) => db.select().from(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).all()) as Record<string, unknown>[] }];
  if (kind === 'characters')
    parts.push({ kind: 'relationships', rows: inChunks(ids, (slice) => db.select().from(s.relationships).where(and(eq(s.relationships.projectId, projectId), or(inArray(s.relationships.fromId, slice), inArray(s.relationships.toId, slice)))).all()) as Record<string, unknown>[] });
  if (kind === 'characters') parts.push({ kind: 'terms', rows: untouchedNameTerms(db, projectId, ids) as Record<string, unknown>[] });
  if (kind === 'events')
    parts.push({ kind: 'eventLinks', rows: inChunks(ids, (slice) => db.select().from(s.eventLinks).where(and(eq(s.eventLinks.projectId, projectId), or(inArray(s.eventLinks.fromId, slice), inArray(s.eventLinks.toId, slice)))).all()) as Record<string, unknown>[] });
  return parts;
}

/**
 * Deletes items of several kinds at once (a graph's selection: people, relationships, speech rules)
 * and keeps what went (with the cascade) under one token for restoreItems.
 */
export function deleteItemsKept(db: DeleteDb, projectId: string, groups: { kind: DeletableKind; ids: string[] }[]) {
  const parts = groups.flatMap(({ kind, ids }) => rowsOf(db, projectId, kind, deletable(db, projectId, kind, ids).ids));
  const tags = parts.flatMap(({ kind, rows }) => inChunks(rows.map((row) => row.id as string), (ids) =>
    db.select().from(s.knowledgeTags).where(kind === 'tags'
      ? inArray(s.knowledgeTags.tagId, ids)
      : and(eq(s.knowledgeTags.kind, kind as typeof s.knowledgeTags.$inferSelect.kind), inArray(s.knowledgeTags.itemId, ids))).all()));
  const unitTags = parts.filter((part) => part.kind === 'tags').flatMap(({ rows }) => inChunks(rows.map((row) => row.id as string), (ids) => db.select().from(s.unitTags).where(inArray(s.unitTags.tagId, ids)).all()));
  db.transaction((tx) => { for (const { kind, ids } of groups) deleteItems(tx, projectId, kind, ids); });
  const token = crypto.randomUUID();
  removed.set(token, { projectId, parts, tags, unitTags, at: Date.now() });
  for (const [key, entry] of removed) if (removed.size > KEEP_MAX || Date.now() - entry.at > KEEP_MS) removed.delete(key);
  return { ok: true as const, token, deleted: parts.reduce((sum, part) => sum + part.rows.length, 0) };
}

/** Puts back what the delete with this token removed (same ids), once. False when it is no longer kept or the project differs. */
export function restoreItems(db: DeleteDb, projectId: string, token: string): boolean {
  const entry = removed.get(token);
  if (!entry || entry.projectId !== projectId) return false;
  // People before the relationships that point at them, events before their lines.
  const order: DeletableKind[] = ['characters', 'relationships', 'speechRules', 'events', 'eventLinks', 'documents', 'terms', 'tags'];
  db.transaction((tx) => {
    for (const kind of order)
      for (const part of entry.parts.filter((candidate) => candidate.kind === kind))
        for (const row of part.rows) tx.insert(DELETABLE[kind].table).values(row as never).onConflictDoNothing().run();
    for (const row of entry.tags) tx.insert(s.knowledgeTags).values(row).onConflictDoNothing().run();
    for (const row of entry.unitTags) tx.insert(s.unitTags).values(row).onConflictDoNothing().run();
  });
  removed.delete(token);
  for (const topic of new Set(entry.parts.map((part) => DELETABLE[part.kind].topic))) events.changed(projectId, topic);
  return true;
}

export function deleteItems(db: DeleteDb, projectId: string, kind: DeletableKind, ids: string[]) {
  const { table, topic } = DELETABLE[kind];
  const { ids: gone, missing } = deletable(db, projectId, kind, ids);
  // A deleted character's untouched name candidates go with it (untouchedNameTerms).
  const nameTerms = kind === 'characters' ? untouchedNameTerms(db, projectId, gone).map((term) => term.id) : [];
  if (nameTerms.length) deleteItems(db, projectId, 'terms', nameTerms);
  if (gone.length) {
    db.transaction((tx) => {
      for (const slice of inChunks(gone, (part) => [part])) {
        // A term's run items name it without a foreign key (run_items.subject_id): they go with it.
        if (kind === 'terms') tx.delete(s.runItems).where(inArray(s.runItems.subjectId, slice)).run();
        tx.delete(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).run();
      }
    });
    events.changed(projectId, topic, ...(kind === 'tags' ? (['units', 'workflows'] as const) : []));
  }
  return { ok: true as const, deleted: gone.length, missing };
}
