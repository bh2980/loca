import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';

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
  documents: { table: s.documents, what: '문서', topic: 'knowledge' },
  terms: { table: s.terms, what: '용어', topic: 'terms' },
  tags: { table: s.tags, what: '태그', topic: 'statuses' },
} as const;
export type DeletableKind = keyof typeof DELETABLE;
export const DELETABLE_KINDS = Object.keys(DELETABLE) as [DeletableKind, ...DeletableKind[]];

/** Which of the ids exist in the project (and may be deleted: the app's own tags may not). */
export function deletable(db: Db, projectId: string, kind: DeletableKind, ids: string[]) {
  const { table } = DELETABLE[kind];
  const rows = inChunks(ids, (slice) => db.select({ id: table.id }).from(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).all());
  const found = new Set(rows.map((row) => row.id));
  const locked = kind === 'tags' ? new Set(inChunks([...found], (slice) => db.select({ id: s.tags.id, role: s.tags.role }).from(s.tags).where(inArray(s.tags.id, slice)).all()).filter((tag) => tag.role).map((tag) => tag.id)) : new Set<string>();
  return { ids: ids.filter((id) => found.has(id) && !locked.has(id)), missing: ids.filter((id) => !found.has(id)), locked: [...locked] };
}

/** What a delete removed, kept for a while so ⌘/Ctrl+Z can put it back (this server process only). */
interface Removed {
  projectId: string;
  parts: { kind: DeletableKind; rows: Record<string, unknown>[] }[];
  at: number;
}
const removed = new Map<string, Removed>();
const KEEP_MS = 60 * 60 * 1000;
const KEEP_MAX = 200;

/** Rows of `ids` and what the cascade takes with them: a character's relationships, an event's lines. */
function rowsOf(db: Db, projectId: string, kind: DeletableKind, ids: string[]) {
  const { table } = DELETABLE[kind];
  const parts = [{ kind, rows: inChunks(ids, (slice) => db.select().from(table).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).all()) as Record<string, unknown>[] }];
  if (kind === 'characters')
    parts.push({ kind: 'relationships', rows: inChunks(ids, (slice) => db.select().from(s.relationships).where(and(eq(s.relationships.projectId, projectId), or(inArray(s.relationships.fromId, slice), inArray(s.relationships.toId, slice)))).all()) as Record<string, unknown>[] });
  if (kind === 'events')
    parts.push({ kind: 'eventLinks', rows: inChunks(ids, (slice) => db.select().from(s.eventLinks).where(and(eq(s.eventLinks.projectId, projectId), or(inArray(s.eventLinks.fromId, slice), inArray(s.eventLinks.toId, slice)))).all()) as Record<string, unknown>[] });
  return parts;
}

/**
 * Deletes items of several kinds at once (a graph's selection: people, relationships, speech rules)
 * and keeps what went (with the cascade) under one token for restoreItems.
 */
export function deleteItemsKept(db: Db, projectId: string, groups: { kind: DeletableKind; ids: string[] }[]) {
  const parts = groups.flatMap(({ kind, ids }) => rowsOf(db, projectId, kind, deletable(db, projectId, kind, ids).ids));
  for (const { kind, ids } of groups) deleteItems(db, projectId, kind, ids);
  const token = crypto.randomUUID();
  removed.set(token, { projectId, parts, at: Date.now() });
  for (const [key, entry] of removed) if (removed.size > KEEP_MAX || Date.now() - entry.at > KEEP_MS) removed.delete(key);
  return { ok: true as const, token, deleted: parts.reduce((sum, part) => sum + part.rows.length, 0) };
}

/** Puts back what the delete with this token removed (same ids), once. False when it is no longer kept or the project differs. */
export function restoreItems(db: Db, projectId: string, token: string): boolean {
  const entry = removed.get(token);
  if (!entry || entry.projectId !== projectId) return false;
  removed.delete(token);
  // People before the relationships that point at them, events before their lines.
  const order: DeletableKind[] = ['characters', 'relationships', 'speechRules', 'events', 'eventLinks', 'documents', 'terms', 'tags'];
  db.transaction((tx) => {
    for (const kind of order)
      for (const part of entry.parts.filter((candidate) => candidate.kind === kind))
        for (const row of part.rows) tx.insert(DELETABLE[kind].table).values(row as never).onConflictDoNothing().run();
  });
  for (const topic of new Set(entry.parts.map((part) => DELETABLE[part.kind].topic))) events.changed(projectId, topic);
  return true;
}

export function deleteItems(db: Db, projectId: string, kind: DeletableKind, ids: string[]) {
  const { table, topic } = DELETABLE[kind];
  const { ids: gone, missing, locked } = deletable(db, projectId, kind, ids);
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
  return { ok: true as const, deleted: gone.length, missing, locked };
}
