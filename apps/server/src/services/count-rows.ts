import { and, count, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

/** How many lines each status has (번역 제외 lines too: the settings page counts every line in it). Only `ids` when given. */
export function statusCountRows(db: Db, projectId: string, ids?: readonly string[]) {
  const wanted = (column: typeof s.statuses.id | typeof s.units.statusId): SQL | undefined => (ids ? inList(column, ids) : undefined);
  const statuses = db.select({ id: s.statuses.id }).from(s.statuses).where(and(eq(s.statuses.projectId, projectId), wanted(s.statuses.id))).all();
  if (!statuses.length) return [];
  const counts = new Map(db.select({ statusId: s.units.statusId, count: count() }).from(s.units).where(and(eq(s.units.projectId, projectId), wanted(s.units.statusId))).groupBy(s.units.statusId).all().map((row) => [row.statusId, row.count]));
  return statuses.map((status) => ({ id: status.id, units: counts.get(status.id) ?? 0 }));
}

/** How many lines and how many knowledge items or terms each tag is on. Only `ids` when given. */
export function tagCountRows(db: Db, projectId: string, ids?: readonly string[]) {
  const tags = db.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.projectId, projectId), ids ? inList(s.tags.id, ids) : undefined)).all();
  if (!tags.length) return [];
  const tagIds = tags.map((tag) => tag.id);
  const units = new Map(db.select({ tagId: s.unitTags.tagId, count: count() }).from(s.unitTags).where(inList(s.unitTags.tagId, tagIds)).groupBy(s.unitTags.tagId).all().map((row) => [row.tagId, row.count]));
  const items = new Map(db.select({ tagId: s.knowledgeTags.tagId, count: count() }).from(s.knowledgeTags).where(inList(s.knowledgeTags.tagId, tagIds)).groupBy(s.knowledgeTags.tagId).all().map((row) => [row.tagId, row.count]));
  return tags.map((tag) => ({ id: tag.id, units: units.get(tag.id) ?? 0, items: items.get(tag.id) ?? 0 }));
}
