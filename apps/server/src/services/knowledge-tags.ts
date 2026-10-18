import { and, eq, inArray } from 'drizzle-orm';
import { REVIEW_TAG, knowledgeKindScope, type KnowledgeTagKind } from '@tw/shared';
import type { Db } from '../db/index.ts';
import { eachChunk } from '../db/chunk.ts';
import { scopeRefusal } from './tag-scope.ts';
import * as s from '../db/schema.ts';

type Tx = Pick<Db, 'select' | 'insert' | 'delete'>;

/** The project's 확인 권장 tag, if something ever needed it. */
const findReviewTagId = (tx: Pick<Db, 'select'>, projectId: string) => tx.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.projectId, projectId), eq(s.tags.role, REVIEW_TAG.role))).get()?.id;

/** The project's 확인 권장 tag, made the first time something needs it. */
function reviewTagId(tx: Tx, projectId: string) {
  return findReviewTagId(tx, projectId) ?? tx.insert(s.tags).values({ projectId, name: REVIEW_TAG.name, color: REVIEW_TAG.color, role: REVIEW_TAG.role }).returning({ id: s.tags.id }).get().id;
}

/** Puts 확인 권장 on an item with why (shown on hover). */
export function markForReview(tx: Tx, projectId: string, kind: KnowledgeTagKind, itemId: string, reasons: string[]) {
  const tagId = reviewTagId(tx, projectId);
  tx.insert(s.knowledgeTags).values({ kind, itemId, tagId, note: reasons.join(', ') }).onConflictDoUpdate({ target: [s.knowledgeTags.kind, s.knowledgeTags.itemId, s.knowledgeTags.tagId], set: { note: reasons.join(', ') } }).run();
}

/** A person decided these items (확인함, 버리기, an edit): 확인 권장 comes off. */
export function clearReview(tx: Tx, projectId: string, kind: KnowledgeTagKind, itemIds: string[]) {
  if (!itemIds.length) return;
  const tagId = findReviewTagId(tx, projectId);
  if (tagId) tx.delete(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, kind), eq(s.knowledgeTags.tagId, tagId), inArray(s.knowledgeTags.itemId, itemIds))).run();
}

/** Each item's tags (id and the app's note), for the knowledge lists. */
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
 * accepted chat proposal. The app's own tags are not put on by hand, and a tag goes only where its
 * scope allows. Returns the refusal, or null when done.
 */
export function setKnowledgeTag(tx: Pick<Db, 'select' | 'insert' | 'delete'>, projectId: string, kind: KnowledgeTagKind, ids: string[], tagId: string, add: boolean): string | null {
  const tag = tx.select({ role: s.tags.role }).from(s.tags).where(and(eq(s.tags.id, tagId), eq(s.tags.projectId, projectId))).get();
  if (!tag) return '태그를 찾을 수 없습니다.';
  if (add && tag.role) return '앱이 붙이는 태그는 직접 붙일 수 없습니다.';
  const refusal = add ? scopeRefusal(tx, projectId, [tagId], knowledgeKindScope(kind)) : null;
  if (refusal) return refusal;
  eachChunk(ids, (slice) => {
    if (add) tx.insert(s.knowledgeTags).values(slice.map((itemId) => ({ kind, itemId, tagId }))).onConflictDoNothing().run();
    else tx.delete(s.knowledgeTags).where(and(eq(s.knowledgeTags.kind, kind), eq(s.knowledgeTags.tagId, tagId), inArray(s.knowledgeTags.itemId, slice))).run();
  }, 2_000);
  return null;
}
