import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { patchOf, TAG_SCOPES, TAG_SCOPE_LABELS } from '@tw/shared';
import { projectTags, tagUseIn } from './tag-scope.ts';
import { deleteItems } from './item-delete.ts';
import { statusInput, tagInput } from '../schemas/projects.ts';

export class TaxonomyMutationError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) { super(message); }
}

function requireFilledTranslations(db: Db, projectId: string, statusId: string) {
  const blank = db.select({ count: count() }).from(s.units)
    .where(and(eq(s.units.projectId, projectId), eq(s.units.statusId, statusId), sql`trim(coalesce(${s.units.translation}, '')) = ''`)).get()!.count;
  if (blank) throw new TaxonomyMutationError(`번역이 비어 있는 대사 ${blank.toLocaleString('ko-KR')}개가 있어 최종 상태로 바꿀 수 없습니다.`);
}

export function createStatus(db: Db, projectId: string, input: unknown) {
  const data = statusInput.parse(input);
  const sort = db.select({ max: sql<number>`coalesce(max(${s.statuses.sort}), -1)` }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!.max + 1;
  const row = db.insert(s.statuses).values({ ...data, projectId, sort }).returning().get();
  events.changed(projectId, 'statuses');
  return row;
}

export function updateStatus(db: Db, projectId: string, id: string, input: unknown) {
  const patch = patchOf(statusInput).parse(input);
  const current = db.select().from(s.statuses).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).get();
  if (!current) throw new TaxonomyMutationError('상태를 찾을 수 없습니다.', 404);
  if ((current.kind === 'initial' || current.kind === 'final') && patch.kind !== undefined && patch.kind !== current.kind) {
    const remaining = db.select({ count: count() }).from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, current.kind))).get()!.count;
    if (remaining <= 1) throw new TaxonomyMutationError(current.kind === 'initial' ? '처음 상태는 하나 이상 있어야 합니다.' : '완료 상태는 하나 이상 있어야 합니다.');
  }
  if (patch.kind === 'final' && current.kind !== 'final') requireFilledTranslations(db, projectId, id);
  const row = db.update(s.statuses).set(patch).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).returning().get();
  events.changed(projectId, 'statuses', 'units');
  return row!;
}

/** Statuses deleted together: their lines move to `moveTo`, and each kind keeps at least one start and one final status. */
export function deleteStatuses(db: Db, projectId: string, ids: string[], moveTo: string) {
  if (ids.includes(moveTo)) throw new TaxonomyMutationError('삭제할 상태로는 옮길 수 없습니다.');
  const target = db.select().from(s.statuses).where(and(eq(s.statuses.id, moveTo), eq(s.statuses.projectId, projectId))).get();
  if (!target) throw new TaxonomyMutationError('옮길 상태를 찾을 수 없습니다.', 404);
  const all = db.select({ id: s.statuses.id, kind: s.statuses.kind }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const doomed = all.filter((status) => ids.includes(status.id));
  if (doomed.length !== new Set(ids).size) throw new TaxonomyMutationError('상태를 찾을 수 없습니다.', 404);
  for (const kind of ['initial', 'final'] as const) {
    if (doomed.some((status) => status.kind === kind) && all.filter((status) => status.kind === kind && !ids.includes(status.id)).length === 0)
      throw new TaxonomyMutationError(kind === 'initial' ? '처음 상태는 하나 이상 있어야 합니다.' : '완료 상태는 하나 이상 있어야 합니다.');
  }
  if (target.kind === 'final') for (const id of ids) requireFilledTranslations(db, projectId, id);
  db.transaction((tx) => {
    tx.update(s.units).set({ statusId: moveTo }).where(and(eq(s.units.projectId, projectId), inArray(s.units.statusId, ids))).run();
    tx.delete(s.statuses).where(and(eq(s.statuses.projectId, projectId), inArray(s.statuses.id, ids))).run();
  });
  events.changed(projectId, 'statuses', 'units', 'workflows');
  return { ok: true as const, deleted: doomed.length };
}

/** The person's own tags in this order; the app's tags keep their place first. */
export function orderTags(db: Db, projectId: string, ids: string[]) {
  db.transaction((tx) => {
    ids.forEach((id, sort) => tx.update(s.tags).set({ sort }).where(and(eq(s.tags.id, id), eq(s.tags.projectId, projectId))).run());
  });
  events.changed(projectId, 'statuses');
  return { ok: true as const };
}

/** Statuses in this order (the settings page's drag), by id; ones not named keep their place after them. */
export function orderStatuses(db: Db, projectId: string, ids: string[]) {
  db.transaction((tx) => {
    ids.forEach((id, sort) => tx.update(s.statuses).set({ sort }).where(and(eq(s.statuses.id, id), eq(s.statuses.projectId, projectId))).run());
  });
  events.changed(projectId, 'statuses');
  return { ok: true as const };
}

export function createTag(db: Db, projectId: string, input: unknown) {
  const sort = db.select({ max: sql<number>`coalesce(max(${s.tags.sort}), -1)` }).from(s.tags).where(eq(s.tags.projectId, projectId)).get()!.max + 1;
  const row = db.insert(s.tags).values({ ...tagInput.parse(input), projectId, sort }).returning().get();
  events.changed(projectId, 'statuses');
  return row;
}

export function updateTag(db: Db, projectId: string, id: string, input: unknown) {
  const patch = patchOf(tagInput).parse(input);
  const tag = db.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.id, id), eq(s.tags.projectId, projectId))).get();
  if (!tag) throw new TaxonomyMutationError('태그를 찾을 수 없습니다.', 404);
  for (const place of patch.scope ? TAG_SCOPES.filter((place) => !patch.scope!.includes(place)) : []) {
    const used = tagUseIn(db, id, place);
    if (used) throw new TaxonomyMutationError(`‘${TAG_SCOPE_LABELS[place]}’에서 빼려면 먼저 이 태그가 붙은 ${TAG_SCOPE_LABELS[place]} ${used.toLocaleString('ko-KR')}개에서 떼어 주세요.`);
  }
  const row = db.update(s.tags).set(patch).where(and(eq(s.tags.id, id), eq(s.tags.projectId, projectId))).returning().get();
  events.changed(projectId, 'statuses', 'units');
  return row!;
}

export function deleteTags(db: Db, projectId: string, ids: string[]) {
  const rows = db.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.projectId, projectId), inArray(s.tags.id, ids))).all();
  if (rows.length !== new Set(ids).size) throw new TaxonomyMutationError('태그를 찾을 수 없습니다.', 404);
  const result = deleteItems(db, projectId, 'tags', ids);
  return { ok: true as const, deleted: result.deleted };
}

export { projectTags };
