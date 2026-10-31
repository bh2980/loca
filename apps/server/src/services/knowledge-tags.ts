import { and, eq, inArray } from 'drizzle-orm';
import { knowledgeKindScope, type KnowledgeTagKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { eachChunk } from '../db/chunk.ts';
import { scopeRefusal } from './tag-scope.ts';
import * as s from '../db/schema.ts';

type Tx = Pick<Db, 'select' | 'insert' | 'delete'>;

/** The knowledge tables 확인 권장 can be on (the automatic tag reads their `reviewNote`). */
const REVIEWABLE = { characters: s.characters, relationships: s.relationships, speechRules: s.speechRules, events: s.storyEvents, documents: s.documents } as const;
const reviewable = (kind: KnowledgeTagKind) => (kind in REVIEWABLE ? REVIEWABLE[kind as keyof typeof REVIEWABLE] : undefined);

/** 확인 권장 on an item: why a person should look (shown on hover). */
export function markForReview(tx: Pick<Db, 'update'>, projectId: string, kind: KnowledgeTagKind, itemId: string, reasons: string[]) {
  const table = reviewable(kind);
  if (table) tx.update(table).set({ reviewNote: reasons.join(', ') }).where(and(eq(table.projectId, projectId), eq(table.id, itemId))).run();
}

/** A person decided these items (확인함, 버리기, an edit): 확인 권장 comes off. */
export function clearReview(tx: Pick<Db, 'update'>, projectId: string, kind: KnowledgeTagKind, itemIds: string[]) {
  const table = reviewable(kind);
  if (table && itemIds.length) eachChunk(itemIds, (slice) => tx.update(table).set({ reviewNote: '' }).where(and(eq(table.projectId, projectId), inArray(table.id, slice))).run());
}

/** Each item's tags (id and note), for the knowledge lists. */
export function tagsOf(db: Db, kind: KnowledgeTagKind, itemIds: string[]) {
  const map = new Map<string, { id: string; note: string | null }[]>();
  if (!itemIds.length) return map;
  const rows = db.select({ itemId: s.knowledgeTags.itemId, tagId: s.knowledgeTags.tagId, note: s.knowledgeTags.note }).from(s.knowledgeTags).where(eq(s.knowledgeTags.kind, kind)).all();
  const wanted = new Set(itemIds);
  for (const row of rows) if (wanted.has(row.itemId)) map.set(row.itemId, [...(map.get(row.itemId) ?? []), { id: row.tagId, note: row.note }]);
  return map;
}

/** Rows with their `tags` added. */
export function withTags<T extends { id: string }>(db: Db, kind: KnowledgeTagKind, rows: T[]) {
  const map = tagsOf(db, kind, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, tags: map.get(row.id) ?? [] }));
}

/**
 * A person's tag on several knowledge items (or terms), or off them: the knowledge lists and an
 * accepted chat proposal. A tag goes only where its scope allows. Returns the refusal, or null when done.
 */
export function setKnowledgeTag(tx: Pick<Db, 'select' | 'insert' | 'delete'>, projectId: string, kind: KnowledgeTagKind, ids: string[], tagId: string, add: boolean): string | null {
  const tag = tx.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.id, tagId), eq(s.tags.projectId, projectId))).get();
  if (!tag) return '태그를 찾을 수 없습니다.';
  const refusal = add ? scopeRefusal(tx, projectId, [tagId], knowledgeKindScope(kind)) : null;
  if (refusal) return refusal;
  eachChunk(ids, (slice) => {
    if (add) tx.insert(s.knowledgeTags).values(slice.map((itemId) => ({ kind, itemId, tagId }))).onConflictDoNothing().run();
    else tx.delete(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, kind), eq(s.knowledgeTags.tagId, tagId), inArray(s.knowledgeTags.itemId, slice))).run();
  }, 2_000);
  return null;
}
