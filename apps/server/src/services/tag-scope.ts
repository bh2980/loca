import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { tagScope, TAG_SCOPE_LABELS, type TagScope } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** Ids among `tagIds` that cannot be put on `scope` (a tag that does not exist counts as out of scope). */
export function outOfScopeTags(db: Pick<Db, 'select'>, projectId: string, tagIds: string[], scope: TagScope) {
  if (!tagIds.length) return [];
  const rows = db.select({ id: s.tags.id, name: s.tags.name, role: s.tags.role, scope: s.tags.scope }).from(s.tags).where(and(eq(s.tags.projectId, projectId), inArray(s.tags.id, tagIds))).all();
  return rows.filter((tag) => !tagScope(tag).includes(scope));
}

/** The refusal text for tags put where they don't belong, or null when all fit. */
export function scopeRefusal(db: Pick<Db, 'select'>, projectId: string, tagIds: string[], scope: TagScope) {
  const bad = outOfScopeTags(db, projectId, tagIds, scope);
  return bad.length ? `${bad.map((tag) => `‘${tag.name}’`).join(', ')} 태그는 ${TAG_SCOPE_LABELS[scope]}에 붙일 수 없습니다(붙는 곳: ${tagScope(bad[0]!).map((place) => TAG_SCOPE_LABELS[place]).join(' · ')}).` : null;
}

/** How many items carry the tag in `scope`: lines, glossary terms, or the other knowledge kinds. */
export function tagUseIn(db: Pick<Db, 'select'>, tagId: string, scope: TagScope) {
  if (scope === 'lines') return db.select({ n: count() }).from(s.unitTags).where(eq(s.unitTags.tagId, tagId)).get()!.n;
  const kind = scope === 'terms' ? eq(s.knowledgeTags.kind, 'terms') : ne(s.knowledgeTags.kind, 'terms');
  return db.select({ n: count() }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.tagId, tagId), kind)).get()!.n;
}
