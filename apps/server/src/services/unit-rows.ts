import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inChunks, inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

export const unitColumns = {
  id: s.units.id,
  key: s.units.key,
  groupId: s.units.groupId,
  sort: s.units.sort,
  kind: s.units.kind,
  speaker: s.units.speaker,
  listener: s.units.listener,
  listenerOrigin: s.units.listenerOrigin,
  listenerConfidence: s.units.listenerConfidence,
  source: s.units.source,
  translation: s.units.translation,
  statusId: s.units.statusId,
  statusBy: s.units.statusBy,
  note: s.units.note,
  translate: s.units.translate,
  statusRunId: s.units.statusRunId,
  updatedAt: s.units.updatedAt,
};

/**
 * A line as every line list shows it (the rows the browser's units collection holds): with its candidate's
 * origin, whether an AI 제안 waits, its tags and its latest run's note, in script order. Its scene is named by
 * id only (groupId): a scene's title, section and kind are the groups collection's, so renaming or moving a
 * scene changes one row there and no line.
 */
function unitRows(db: Db, where: SQL | undefined) {
  const rows = db
    .select({ ...unitColumns, origin: s.candidates.origin, model: s.candidates.model, suggested: sql`exists (select 1 from ${s.candidates} c where c.unit_id = ${s.units.id} and c.state = 'pending')`.mapWith(Boolean) })
    .from(s.units)
    .leftJoin(s.candidates, eq(s.candidates.id, s.units.candidateId))
    .where(where)
    .orderBy(asc(s.units.seq))
    .all();
  const ids = rows.map((row) => row.id);
  const tagRows = inChunks(ids, (slice) => db.select().from(s.unitTags).where(inArray(s.unitTags.unitId, slice)).all());
  const tags = Map.groupBy(tagRows, (row) => row.unitId);
  // What the latest run said about each line (a reviewer's reason to look), newest run first.
  const lastRun = new Map<string, { runId: string; workflowName: string; issues: string[] }>();
  const runRows = inChunks(ids, (slice) =>
    db
      .select({ unitId: s.runItems.subjectId, runId: s.runs.id, workflowName: s.runs.workflowName, data: s.runItems.data, createdAt: s.runs.createdAt })
      .from(s.runItems)
      .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
      .where(inArray(s.runItems.subjectId, slice))
      .orderBy(desc(s.runs.createdAt))
      .all(),
  ).sort((a, b) => +b.createdAt - +a.createdAt);
  for (const item of runRows) if (!lastRun.has(item.unitId)) lastRun.set(item.unitId, { runId: item.runId, workflowName: item.workflowName, issues: item.data.issues ?? [] });
  return rows.map((row) => ({ ...row, tagIds: (tags.get(row.id) ?? []).map((tag) => tag.tagId), lastRun: lastRun.get(row.id) ?? null }));
}

/** The project's lines by id, in the order asked (ids it does not have are left out). */
export function unitRowsByIds(db: Db, projectId: string, ids: readonly string[]) {
  if (!ids.length) return [];
  const byId = new Map(unitRows(db, and(eq(s.units.projectId, projectId), inList(s.units.id, ids))).map((row) => [row.id, row] as const));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}
