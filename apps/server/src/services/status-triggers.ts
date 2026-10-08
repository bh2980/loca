import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRun } from '../engine/runner.ts';
import { workflowIssues } from '../routes/workflows.ts';
import { snapshotProfiles } from './routes.ts';

export interface TriggerResult {
  workflowName: string;
  runId?: string;
  count: number;
  /** Why nothing started (broken workflow, every line already in a run). */
  skipped?: string;
}

/**
 * A person moved lines into a status that has an on-enter workflow: start it for exactly
 * those lines. Status changes made by workflows themselves never trigger (no loops, and a
 * workflow that sets "needs review" already routes the line where it wants it).
 */
export function runStatusTrigger(db: Db, projectId: string, statusId: string, unitIds: string[]): TriggerResult | null {
  const status = db.select().from(s.statuses).where(and(eq(s.statuses.id, statusId), eq(s.statuses.projectId, projectId))).get();
  if (!status?.onEnterWorkflowId || !unitIds.length) return null;
  const workflow = db.select().from(s.workflows).where(and(eq(s.workflows.id, status.onEnterWorkflowId), eq(s.workflows.projectId, projectId))).get();
  if (!workflow) return null;
  const errors = workflowIssues(db, projectId, workflow.definition).filter((issue) => issue.level === 'error');
  if (errors.length) return { workflowName: workflow.name, count: 0, skipped: `워크플로에 오류가 있어 시작하지 않았습니다: ${errors[0].message}` };

  // A line already moving through a run (or waiting in the inbox) is left where it is.
  const busy = new Set(
    db
      .select({ unitId: s.runItems.unitId })
      .from(s.runItems)
      .where(and(inArray(s.runItems.unitId, unitIds), inArray(s.runItems.state, ['queued', 'running', 'waiting'])))
      .all()
      .map((row) => row.unitId),
  );
  const free = unitIds.filter((id) => !busy.has(id));
  if (!free.length) return { workflowName: workflow.name, count: 0, skipped: '모두 이미 실행 중이거나 검토함에 있습니다.' };

  const profileIds = [...new Set(workflow.definition.nodes.flatMap((node) => (node.type === 'ai' ? [node.config.profileId] : [])))];
  const { runId, total } = createRun(db, { projectId, workflow, profiles: snapshotProfiles(db, profileIds), scope: { unitIds: free, ignoreStatus: true } });
  return { workflowName: workflow.name, runId, count: total };
}
