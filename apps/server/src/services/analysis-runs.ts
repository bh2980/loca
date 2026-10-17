import { and, desc, eq, sql } from 'drizzle-orm';
import { ANALYSIS_WORKFLOW, ANALYSIS_WORKFLOW_DESCRIPTION, analysisNodes, analysisTemplate, isAnalysisWorkflow, withRunModels, type ModelChoice } from '@tw/shared';
export { isAnalysisWorkflow };
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { createRunInSteps, refuseSecondAnalysis, runActive } from '../engine/run-create.ts';
import { workflowIssues } from './workflow-issues.ts';
import { liveChoice, snapshotWorkflowModels } from './routes.ts';
import type { SecretStore } from './secrets.ts';

/**
 * The 작품 분석 button (#47): work analysis is an ordinary workflow run now. The button starts the
 * project's '작품 분석' workflow (made from the template on first use) on the picked model, and its
 * runs are listed in the shape the analysis panels read, after the jobs of the old analysis service.
 */


/** The workflow the button runs: the one named '작품 분석' with an analysis node, else the first with one, else a new one. */
export function analysisWorkflow(db: Db, projectId: string, model: ModelChoice) {
  const rows = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().filter((row) => isAnalysisWorkflow(row.definition));
  const named = rows.find((row) => row.name === ANALYSIS_WORKFLOW) ?? rows[0];
  if (named) return named;
  const row = db
    .insert(s.workflows)
    .values({ projectId, name: ANALYSIS_WORKFLOW, description: ANALYSIS_WORKFLOW_DESCRIPTION, definition: analysisTemplate({ model }) })
    .returning()
    .get();
  events.changed(projectId, 'workflows');
  return row;
}

/** Analysis runs of the project, newest first. */
function analysisRuns(db: Db, projectId: string, limit: number) {
  return db.select().from(s.runs).where(eq(s.runs.projectId, projectId)).orderBy(desc(s.runs.createdAt)).limit(100).all().filter((run) => isAnalysisWorkflow(run.definition)).slice(0, limit);
}

/** Starts a whole-script analysis on `model` (every analysis node of the workflow uses it for this run). */
export async function startAnalysis(db: Db, secrets: SecretStore, projectId: string, model: ModelChoice) {
  refuseSecondAnalysis(db, projectId);
  liveChoice(db, model, secrets, 'generate');
  const stored = analysisWorkflow(db, projectId, model);
  const definition = withRunModels(stored.definition, Object.fromEntries(analysisNodes(stored.definition).map((node) => [node.id, model])));
  const errors = workflowIssues(db, projectId, definition).filter((issue) => issue.level === 'error');
  if (errors.length) throw new Error(`'${stored.name}' 워크플로에 오류가 ${errors.length}개 있습니다: ${errors[0]!.message}`);
  return createRunInSteps(db, { projectId, workflow: { ...stored, definition }, models: snapshotWorkflowModels(db, definition), scope: {} });
}

export type AnalysisStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * The project's analyses for the panels (시작하기, 자료, notices), newest first: analysis runs, then the
 * old service's jobs. A run's parts are its requests (plan batches); its result sums what the save
 * step stored; a run that stopped on failures or ended with failed lines counts as failed.
 */
export function listAnalyses(db: Db, projectId: string) {
  const runs = analysisRuns(db, projectId, 10).map((run) => {
    const node = analysisNodes(run.definition)[0]!;
    const save = run.definition.nodes.find((other) => other.type === 'function' && other.config.fn === 'saveAnalysis');
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
    const result: Record<string, number> = {};
    if (save)
      for (const row of db.select({ counts: sql<string | null>`json_extract(${s.runItems.data}, ${`$.outputs."${save.id}".counts`})` }).from(s.runItems).where(and(eq(s.runItems.runId, run.id), sql`json_extract(${s.runItems.data}, ${`$.outputs."${save.id}".counts`}) is not null`)).all())
        for (const [key, value] of Object.entries(JSON.parse(row.counts ?? '{}') as Record<string, number>)) result[key] = (result[key] ?? 0) + value;
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
      result: status === 'completed' || Object.keys(result).length ? result : null,
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
