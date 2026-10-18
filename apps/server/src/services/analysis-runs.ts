import { and, desc, eq, sql } from 'drizzle-orm';
import { analysisNodes, isAnalysisWorkflow } from '@tw/shared';
export { isAnalysisWorkflow };
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { runActive } from '../engine/run-create.ts';

/**
 * Work analyses for the panels (시작하기, 자료, notices): runs of any workflow with a whole-script AI
 * node, listed in the shape those panels read, after the jobs of the old analysis service. Starting
 * one is an ordinary run of the saved workflow (the run dialog); nothing here starts a run.
 */

/** Analysis runs of the project, newest first. */
function analysisRuns(db: Db, projectId: string, limit: number) {
  return db.select().from(s.runs).where(eq(s.runs.projectId, projectId)).orderBy(desc(s.runs.createdAt)).limit(100).all().filter((run) => isAnalysisWorkflow(run.definition)).slice(0, limit);
}

export type AnalysisStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * The project's analyses for the panels (시작하기, 자료, notices), newest first: analysis runs, then the
 * old service's jobs. A run's parts are its requests (plan batches);  a run that stopped on failures or ended with failed lines counts as failed.
 */
export function listAnalyses(db: Db, projectId: string) {
  const runs = analysisRuns(db, projectId, 10).map((run) => {
    const node = analysisNodes(run.definition)[0]!;
    const steps = db
      .select({ ok: s.runSteps.ok, error: s.runSteps.error, inputTokens: s.runSteps.inputTokens, outputTokens: s.runSteps.outputTokens, costUsd: s.runSteps.costUsd })
      .from(s.runSteps)
      .where(and(eq(s.runSteps.runId, run.id), eq(s.runSteps.nodeId, node.id)))
      .orderBy(s.runSteps.startedAt)
      .all();
    const items = db
      .select({ parts: sql<number>`count(distinct ${s.runItems.plan})`, failed: sql<number>`sum(${s.runItems.state} = 'failed')`, open: sql<number>`sum(${s.runItems.state} in ('queued', 'running'))` })
      .from(s.runItems)
      .where(eq(s.runItems.runId, run.id))
      .get();
    // What it reads: scenes and an estimate of the script text sent (line text plus ids and speakers, bytes / 4 as before).
    const read = db
      .select({ scenes: sql<number>`count(distinct ${s.units.groupId})`, bytes: sql<number>`coalesce(sum(length(cast(${s.units.source} as blob)) + length(cast(coalesce(${s.units.speaker}, '') as blob)) + 8), 0)` })
      .from(s.runItems)
      .innerJoin(s.units, eq(s.units.id, s.runItems.unitId))
      .where(eq(s.runItems.runId, run.id))
      .get();
    const done = steps.filter((step) => step.ok).length;
    const failedStep = steps.findLast((step) => !step.ok);
    const status: AnalysisStatus = runActive(run)
      ? 'running'
      : run.status === 'cancelled'
        ? 'cancelled'
        : run.status === 'paused' || (items?.failed ?? 0) > 0
          ? 'failed'
          : 'completed';
    const sum = (key: 'inputTokens' | 'outputTokens' | 'costUsd') => steps.reduce((total, step) => total + (step[key] ?? 0), 0);
    return {
      id: run.id,
      projectId,
      /** The run behind it (실행 기록 opens it). */
      runId: run.id as string | null,
      connectionId: node.config.model.connectionId,
      model: node.config.model.model,
      effort: node.config.model.effort ?? null,
      status,
      partsDone: Math.min(done, Math.max(1, items?.parts ?? 1)),
      partsTotal: Math.max(1, items?.parts ?? 1, done),
      usage: { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), costUsd: sum('costUsd') },
      /** What a run saved is proposals now (or direct writes), not counted here; only the old service's jobs carry counts. */
      result: null as Record<string, number> | null,
      input: { lines: run.total, scenes: read?.scenes ?? 0, tokens: Math.round((read?.bytes ?? 0) / 4) },
      error: status === 'failed' ? (failedStep?.error ?? run.notice ?? '일부 줄을 분석하지 못했습니다.') : null,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    };
  });
  const jobs = db
    .select()
    .from(s.analysisJobs)
    .where(eq(s.analysisJobs.projectId, projectId))
    .orderBy(desc(s.analysisJobs.createdAt))
    .limit(10)
    .all()
    .map(({ parts: _parts, ...job }) => ({ ...job, runId: null as string | null }));
  return [...runs, ...jobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10);
}
