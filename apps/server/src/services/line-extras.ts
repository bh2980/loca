import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

/** How many runs a line's history shows, newest first. */
const HISTORY = 20;

/**
 * What the line detail shows besides the line and its context: its texts and AI 제안 (candidates,
 * newest first) and the runs that went through it (실행 기록). The browser holds these for the lines
 * it has open and reads them again when the row feed names the line (candidates and run items note it).
 */
export function lineExtras(db: Db, projectId: string, ids: readonly string[]) {
  const own = inChunks(ids, (slice) => db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), inArray(s.units.id, slice))).all()).map((row) => row.id);
  if (!own.length) return [];
  const candidates = Map.groupBy(
    inChunks(own, (slice) => db.select().from(s.candidates).where(inArray(s.candidates.unitId, slice)).orderBy(desc(s.candidates.createdAt)).all()).sort((a, b) => +b.createdAt - +a.createdAt),
    (row) => row.unitId,
  );
  const history = Map.groupBy(
    inChunks(own, (slice) =>
      db
        .select({ unitId: s.runItems.subjectId, id: s.runItems.id, runId: s.runs.id, workflowName: s.runs.workflowName, state: s.runItems.state, nodeId: s.runItems.nodeId, error: s.runItems.error, data: s.runItems.data, createdAt: s.runs.createdAt })
        .from(s.runItems)
        .innerJoin(s.runs, eq(s.runs.id, s.runItems.runId))
        .where(inArray(s.runItems.subjectId, slice))
        .orderBy(desc(s.runs.createdAt))
        .all(),
    ).sort((a, b) => +b.createdAt - +a.createdAt),
    (row) => row.unitId,
  );
  return own.map((id) => ({ id, candidates: candidates.get(id) ?? [], history: (history.get(id) ?? []).slice(0, HISTORY).map(({ unitId: _unit, ...run }) => run) }));
}

export type LineExtras = ReturnType<typeof lineExtras>[number];
