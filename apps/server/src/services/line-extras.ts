import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inChunks } from '../db/chunk.ts';
import { nodeName } from '@tw/shared';
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
  // The workflow step that left a text or touched the line, named as the run's own definition named it ('검수'), so the
  // history can say which step of the workflow it was; null when the run or the node is gone.
  const runIds = [...new Set([...[...candidates.values()].flat().map((row) => row.runId), ...[...history.values()].flat().map((row) => row.runId)].filter((runId): runId is string => Boolean(runId)))];
  const definitions = new Map(inChunks(runIds, (slice) => db.select({ id: s.runs.id, definition: s.runs.definition }).from(s.runs).where(inArray(s.runs.id, slice)).all()).map((row) => [row.id, row.definition]));
  const step = (runId: string | null, nodeId: string | null) => {
    const node = runId && nodeId ? definitions.get(runId)?.nodes.find((item) => item.id === nodeId) : undefined;
    return node ? nodeName(node) : null;
  };
  return own.map((id) => ({
    id,
    candidates: (candidates.get(id) ?? []).map((row) => ({ ...row, step: step(row.runId, row.nodeId) })),
    history: (history.get(id) ?? []).slice(0, HISTORY).map(({ unitId: _unit, ...run }) => ({ ...run, step: step(run.runId, run.nodeId) })),
  }));
}

export type LineExtras = ReturnType<typeof lineExtras>[number];
