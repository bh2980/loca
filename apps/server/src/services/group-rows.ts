import { and, asc, count, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';
import { excludedSql, translatableSql, unknownListenerSql } from './line-marks.ts';

/**
 * Scenes, documents and UI groups with their progress, in script order: lines for translation by
 * status, 번역 제외 lines apart, and lines whose listener is unknown (청자 모름: where speech rules
 * cannot apply yet). Only `ids` when given. The browser's groups collection holds these rows (feed.ts).
 */
export function groupRows(db: Db, projectId: string, ids?: readonly string[]) {
  const inGroups = (column: typeof s.groups.id | typeof s.units.groupId): SQL | undefined => (ids ? inList(column, ids) : undefined);
  const rows = db
    .select({ id: s.groups.id, key: s.groups.key, kind: s.groups.kind, title: s.groups.title, description: s.groups.description, section: s.groups.section, sort: s.groups.sort })
    .from(s.groups)
    .where(and(eq(s.groups.projectId, projectId), inGroups(s.groups.id)))
    .orderBy(asc(s.groups.sort))
    .all();
  if (!rows.length) return [];
  const lines = (where: SQL) => and(eq(s.units.projectId, projectId), inGroups(s.units.groupId), where)!;
  const byGroup = Map.groupBy(db.select({ groupId: s.units.groupId, statusId: s.units.statusId, count: count() }).from(s.units).where(lines(translatableSql(projectId))).groupBy(s.units.groupId, s.units.statusId).all(), (row) => row.groupId);
  const counted = (where: SQL) => new Map(db.select({ groupId: s.units.groupId, count: count() }).from(s.units).where(lines(where)).groupBy(s.units.groupId).all().map((row) => [row.groupId, row.count]));
  const excluded = counted(excludedSql(projectId));
  const unknown = counted(unknownListenerSql(projectId));
  return rows.map((group) => {
    const statuses = Object.fromEntries((byGroup.get(group.id) ?? []).map((row) => [row.statusId, row.count]));
    return { ...group, total: Object.values(statuses).reduce((sum, value) => sum + value, 0), statuses, excluded: excluded.get(group.id) ?? 0, unknownListeners: unknown.get(group.id) ?? 0 };
  });
}

export type GroupRow = ReturnType<typeof groupRows>[number];
