import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { patchOf, TAG_SCOPES, TAG_SCOPE_LABELS } from '@loca/shared';
import { projectTags, tagUseIn } from '../domain/tag-scope.ts';
import { deleteItems } from './item-delete.ts';
import { blankLinesIn, setLineStatus, type StatusSetter } from '../domain/line-save.ts';
import { statusInput, tagInput } from '../schemas/projects.ts';
import { badRequest, notFound, valid } from '../refusal.ts';

export function createStatus(db: Db, projectId: string, input: unknown) {
  const data = valid(statusInput, input, '상태 이름이나 설정');
  const sort = db.select({ max: sql<number>`coalesce(max(${s.statuses.sort}), -1)` }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!.max + 1;
  const row = db.insert(s.statuses).values({ ...data, projectId, sort }).returning().get();
  return row;
}

export function updateStatus(db: Db, projectId: string, id: string, input: unknown) {
  const patch = valid(patchOf(statusInput), input, '상태 이름이나 설정');
  const current = db.select().from(s.statuses).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).get();
  if (!current) notFound('상태');
  if ((current.kind === 'initial' || current.kind === 'final') && patch.kind !== undefined && patch.kind !== current.kind) {
    const remaining = db.select({ count: count() }).from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, current.kind))).get()!.count;
    if (remaining <= 1) badRequest(current.kind === 'initial' ? '처음 상태는 하나 이상 있어야 합니다.' : '완료 상태는 하나 이상 있어야 합니다.');
  }
  // A final status needs a translation (line-save.ts): the status may not become final over lines that have none.
  const blank = patch.kind === 'final' && current.kind !== 'final' ? blankLinesIn(db, projectId, [id]) : 0;
  if (blank) badRequest(`번역이 비어 있는 대사 ${blank.toLocaleString('ko-KR')}개가 있어 최종 상태로 바꿀 수 없습니다.`);
  const row = db.update(s.statuses).set(patch).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).returning().get();
  return row!;
}

/**
 * Statuses deleted together: their lines move to `moveTo` through the one status writer (setLineStatus), so its rules
 * hold here too (no line without a translation lands in a final status; nothing is deleted then) and the lines' new
 * status is whoever deleted the statuses'. Each kind keeps at least one start and one final status.
 */
export function deleteStatuses(db: Db, projectId: string, ids: string[], moveTo: string, by: StatusSetter = { statusBy: 'human' }) {
  if (ids.includes(moveTo)) badRequest('삭제할 상태로는 옮길 수 없습니다.');
  const target = db.select().from(s.statuses).where(and(eq(s.statuses.id, moveTo), eq(s.statuses.projectId, projectId))).get();
  if (!target) notFound('옮길 상태');
  const all = db.select({ id: s.statuses.id, kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const doomed = all.filter((status) => ids.includes(status.id));
  if (doomed.length !== new Set(ids).size) notFound('상태');
  for (const kind of ['initial', 'final'] as const) {
    if (doomed.some((status) => status.kind === kind) && all.filter((status) => status.kind === kind && !ids.includes(status.id)).length === 0)
      badRequest(kind === 'initial' ? '처음 상태는 하나 이상 있어야 합니다.' : '완료 상태는 하나 이상 있어야 합니다.');
  }
  db.transaction((tx) => {
    const moving = tx.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.statusId, ids))).all().map((line) => line.id);
    if (moving.length) setLineStatus(tx, projectId, moving, moveTo, by);
    tx.delete(s.statuses).where(and(eq(s.statuses.projectId, projectId), inArray(s.statuses.id, ids))).run();
  });
  return { ok: true as const, deleted: doomed.length };
}

/** The person's own tags in this order; the app's tags keep their place first. */
export function orderTags(db: Db, projectId: string, ids: string[]) {
  db.transaction((tx) => {
    ids.forEach((id, sort) => tx.update(s.tags).set({ sort }).where(and(eq(s.tags.id, id), eq(s.tags.projectId, projectId))).run());
  });
  return { ok: true as const };
}

/** Statuses in this order (the settings page's drag), by id; ones not named keep their place after them. */
export function orderStatuses(db: Db, projectId: string, ids: string[]) {
  db.transaction((tx) => {
    ids.forEach((id, sort) => tx.update(s.statuses).set({ sort }).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).run());
  });
  return { ok: true as const };
}

export function createTag(db: Db, projectId: string, input: unknown) {
  const sort = db.select({ max: sql<number>`coalesce(max(${s.tags.sort}), -1)` }).from(s.tags).where(eq(s.tags.projectId, projectId)).get()!.max + 1;
  const row = db.insert(s.tags).values({ ...valid(tagInput, input, '태그 이름이나 설정'), projectId, sort }).returning().get();
  return row;
}

export function updateTag(db: Db, projectId: string, id: string, input: unknown) {
  const patch = valid(patchOf(tagInput), input, '태그 이름이나 설정');
  const tag = db.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.id, id), eq(s.tags.projectId, projectId))).get();
  if (!tag) notFound('태그');
  for (const place of patch.scope ? TAG_SCOPES.filter((place) => !patch.scope!.includes(place)) : []) {
    const used = tagUseIn(db, id, place);
    if (used) badRequest(`‘${TAG_SCOPE_LABELS[place]}’에서 빼려면 먼저 이 태그가 붙은 ${TAG_SCOPE_LABELS[place]} ${used.toLocaleString('ko-KR')}개에서 떼어 주세요.`);
  }
  const row = db.update(s.tags).set(patch).where(and(eq(s.tags.id, id), eq(s.tags.projectId, projectId))).returning().get();
  return row!;
}

export function deleteTags(db: Db, projectId: string, ids: string[]) {
  const rows = db.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.projectId, projectId), inArray(s.tags.id, ids))).all();
  if (rows.length !== new Set(ids).size) notFound('태그');
  const result = deleteItems(db, projectId, 'tags', ids);
  return { ok: true as const, deleted: result.deleted };
}

export { projectTags };
