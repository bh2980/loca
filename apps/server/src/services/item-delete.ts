import { and, eq, inArray } from 'drizzle-orm';
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
