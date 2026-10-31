import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { normalizeTagScopes, TAG_SCOPE_LABELS, type TagScope } from '@tw/shared';
import { badRequest } from '../http-errors.ts';
import { eachChunk } from '../db/chunk.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** Ids among `tagIds` that cannot be put on `scope` (a tag that does not exist counts as out of scope). */
export function outOfScopeTags(db: Pick<Db, 'select'>, projectId: string, tagIds: string[], scope: TagScope) {
  if (!tagIds.length) return [];
  const rows = db.select({ id: s.tags.id, name: s.tags.name, scope: s.tags.scope }).from(s.tags).where(and(eq(s.tags.projectId, projectId), inArray(s.tags.id, tagIds))).all();
  return rows.filter((tag) => !normalizeTagScopes(tag.scope).includes(scope));
}

/** The refusal text for tags put where they don't belong, or null when all fit. */
export function scopeRefusal(db: Pick<Db, 'select'>, projectId: string, tagIds: string[], scope: TagScope) {
  const bad = outOfScopeTags(db, projectId, tagIds, scope);
  return bad.length ? `${bad.map((tag) => `‘${tag.name}’`).join(', ')} 태그는 ${TAG_SCOPE_LABELS[scope]}에 붙일 수 없습니다(붙는 곳: ${normalizeTagScopes(bad[0]!.scope).map((place) => TAG_SCOPE_LABELS[place]).join(' · ')}).` : null;
}

/** How many items carry the tag in `scope`: lines, glossary terms, or the other knowledge kinds. */
export function tagUseIn(db: Pick<Db, 'select'>, tagId: string, scope: TagScope) {
  if (scope === 'lines') return db.select({ n: count() }).from(s.unitTags).where(eq(s.unitTags.tagId, tagId)).get()!.n;
  if (scope === 'terms') return db.select({ n: count() }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.tagId, tagId), eq(s.knowledgeTags.kind, 'terms'))).get()!.n;
  if (scope === 'documents') return db.select({ n: count() }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.tagId, tagId), eq(s.knowledgeTags.kind, 'documents'))).get()!.n;
  if (scope === 'events') return db.select({ n: count() }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.tagId, tagId), eq(s.knowledgeTags.kind, 'events'))).get()!.n;
  if (scope === 'people') return db.select({ n: count() }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.tagId, tagId), inArray(s.knowledgeTags.kind, ['characters', 'relationships', 'speechRules']))).get()!.n;
  if ((scope as string) === 'knowledge') return db.select({ n: count() }).from(s.knowledgeTags).where(and(eq(s.knowledgeTags.tagId, tagId), inArray(s.knowledgeTags.kind, ['characters', 'relationships', 'speechRules', 'documents', 'events']))).get()!.n;
  return 0;
}

/**
 * Puts tags on lines and takes tags off them, for every path that tags lines (the list, the line
 * pane, an accepted proposal, a workflow, an import). A tag to add must be the project's and may be
 * put on lines: one that is not is refused (400) or, with 'skip', left off and returned so the
 * caller can say so. `unitIds` are the project's lines; removal is limited to them anyway.
 */
export function attachUnitTags(
  tx: Pick<Db, 'select' | 'insert' | 'delete'>,
  projectId: string,
  unitIds: readonly string[],
  change: { add?: readonly string[]; remove?: readonly string[] },
  options: { onMisplaced: 'refuse' | 'skip' },
) {
  let add = [...new Set(change.add)];
  const skipped: { id: string; name: string }[] = [];
  if (add.length) {
    const tags = new Map(tx.select({ id: s.tags.id, name: s.tags.name, scope: s.tags.scope }).from(s.tags).where(and(eq(s.tags.projectId, projectId), inArray(s.tags.id, add))).all().map((tag) => [tag.id, tag]));
    const unknown = add.filter((id) => !tags.has(id));
    const misplaced = [...tags.values()].filter((tag) => !normalizeTagScopes(tag.scope).includes('lines'));
    if (options.onMisplaced === 'refuse') {
      if (unknown.length) badRequest('이 프로젝트에 없는 태그입니다.');
      if (misplaced.length) badRequest(scopeRefusal(tx, projectId, add, 'lines')!);
    }
    skipped.push(...unknown.map((id) => ({ id, name: id })), ...misplaced.map((tag) => ({ id: tag.id, name: tag.name })));
    const out = new Set(skipped.map((tag) => tag.id));
    add = add.filter((id) => !out.has(id));
  }
  const remove = [...new Set(change.remove)];
  eachChunk(unitIds, (slice) => {
    if (remove.length) tx.delete(s.unitTags).where(and(inArray(s.unitTags.unitId, slice), inArray(s.unitTags.tagId, remove), inArray(s.unitTags.unitId, tx.select({ id: s.units.id }).from(s.units).where(eq(s.units.projectId, projectId))))).run();
    if (add.length) tx.insert(s.unitTags).values(slice.flatMap((unitId) => add.map((tagId) => ({ unitId, tagId })))).onConflictDoNothing().run();
  }, Math.max(1, Math.floor(30_000 / Math.max(1, add.length * 2))));
  return { skipped };
}

/** The project's tags with where each can be put (scope) and how many lines and knowledge items carry it. */
export function projectTags(db: Pick<Db, 'select'>, projectId: string) {
  return db
    .select({
      id: s.tags.id,
      name: s.tags.name,
      color: s.tags.color,
      description: s.tags.description,
      scope: s.tags.scope,
      units: sql<number>`(select count(*) from unit_tags ut where ut.tag_id = "tags"."id")`,
      items: sql<number>`(select count(*) from knowledge_tags kt where kt.tag_id = "tags"."id")`,
    })
    .from(s.tags)
    .where(eq(s.tags.projectId, projectId))
    .orderBy(asc(s.tags.sort), asc(s.tags.name))
    .all()
    .map((tag) => ({ ...tag, scope: normalizeTagScopes(tag.scope) }));
}
