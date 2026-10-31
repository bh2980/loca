import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { inList } from '../db/chunk.ts';
import * as s from '../db/schema.ts';

/** How many runs the runs list and the browser's runs collection hold: the latest ones. */
export const RUNS_LISTED = 200;

/**
 * Workflow runs, newest first, with how many of their lines are in each state. Per line, not per
 * item: a line sent down several branches has an item in each, and is done only when every branch is
 * (running > queued > failed > cancelled > done). Only `ids` when given, else the latest RUNS_LISTED.
 */
export function runRows(db: Db, projectId: string, ids?: readonly string[]) {
  const query = db
    .select({ id: s.runs.id, workflowId: s.runs.workflowId, workflowName: s.runs.workflowName, workflowVersion: s.runs.workflowVersion, subject: s.runs.subject, status: s.runs.status, notice: s.runs.notice, total: s.runs.total, createdAt: s.runs.createdAt, finishedAt: s.runs.finishedAt })
    .from(s.runs)
    .where(and(eq(s.runs.projectId, projectId), ids ? inList(s.runs.id, ids) : undefined))
    .orderBy(desc(s.runs.createdAt));
  const runs = ids ? query.all() : query.limit(RUNS_LISTED).all();
  if (!runs.length) return [];
  const counts = db.all<{ runId: string; state: s.ItemState; count: number }>(sql`
    select run_id as runId, state, count(*) as count from (
      select i.run_id, case
        when sum(i.state = 'running') > 0 then 'running'
        when sum(i.state = 'queued') > 0 then 'queued'
        when sum(i.state = 'failed') > 0 then 'failed'
        when sum(i.state = 'cancelled') > 0 then 'cancelled'
        else 'done' end as state
      from ${s.runItems} i
      where i.run_id in (select value from json_each(${JSON.stringify(runs.map((run) => run.id))}))
      group by i.run_id, i.subject_id
    ) group by run_id, state`);
  const byRun = Map.groupBy(counts, (row) => row.runId);
  return runs.map((run) => ({ ...run, states: Object.fromEntries((byRun.get(run.id) ?? []).map((row) => [row.state, row.count])) }));
}

export type RunRow = ReturnType<typeof runRows>[number];
