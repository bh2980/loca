import { and, eq, inArray } from 'drizzle-orm';
import { choiceKey, linesById, someOf, withRunModels, type AiNode, type RunModels, type RunScope } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { workflowIssues } from './workflow-issues.ts';
import { preflight } from './preflight.ts';
import { snapshotChoices } from './routes.ts';

type Run = typeof s.runs.$inferSelect;

/**
 * A paused or finished run continued on other models (#41): the run's own definition with the
 * picked AI steps switched, plus snapshots of the new
 * models. Only the run changes; the workflow keeps its own models.
 */
export function switchedRun(db: Db, run: Run, models: RunModels | undefined) {
  const picked = Object.fromEntries(Object.entries(models ?? {}).filter(([nodeId, choice]) => {
    const node = run.definition.nodes.find((candidate): candidate is AiNode => candidate.id === nodeId && candidate.type === 'ai');
    return node && (choiceKey(node.config.model) !== choiceKey(choice));
  }));
  const definition = withRunModels(run.definition, picked);
  const issues = workflowIssues(db, run.projectId, definition).filter((issue) => issue.level === 'error' && issue.nodeId && issue.nodeId in picked);
  if (issues.length) return { ok: false as const, error: issues[0].message };
  const fresh = snapshotChoices(db, Object.values(picked));
  const missing = Object.values(picked).find((choice) => !fresh[choiceKey(choice)]);
  if (missing) return { ok: false as const, error: '고른 AI 연결을 찾을 수 없습니다.' };
  const label = (choice: { connectionId: string; model: string }, snapshots: Record<string, s.AiSnapshot>) => snapshots[choiceKey(choice)]?.label ?? choice.model;
  const changes = Object.entries(picked).map(([nodeId, choice]) => {
    const before = run.definition.nodes.find((node) => node.id === nodeId) as AiNode;
    return { nodeId, from: label(before.config.model, run.models), to: label(choice, fresh) };
  });
  return { ok: true as const, definition, models: { ...run.models, ...fresh }, changes };
}

/** The lines the run still has to do: queued and in flight, plus the failed ones when they go again. */
export function remainingLines(db: Db, runId: string, retryFailed: boolean) {
  const states: s.ItemState[] = retryFailed ? ['queued', 'running', 'failed'] : ['queued', 'running'];
  return [...new Set(db.select({ unitId: s.runItems.subjectId }).from(s.runItems).where(and(eq(s.runItems.runId, runId), inArray(s.runItems.state, states))).all().map((row) => row.unitId))];
}

/**
 * The preflight for continuing: the plan and estimate for the remaining lines on the picked models.
 * It counts each remaining line through the whole workflow, so a line already past some steps makes
 * it an upper bound.
 */
export async function continuePreflight(db: Db, run: Run, models: RunModels | undefined, retryFailed: boolean) {
  const switched = switchedRun(db, run, models);
  if (!switched.ok) return switched;
  const unitIds = remainingLines(db, run.id, retryFailed);
  // The run's items as they are: lines by id regardless of status, or terms by id.
  const ids = someOf(unitIds);
  const scope: RunScope = run.subject === 'terms' ? { terms: ids ? { ids } : { nothing: true } } : { filter: linesById(unitIds) };
  const plan = await preflight(db, { id: run.workflowId, projectId: run.projectId, definition: switched.definition }, scope);
  // On the same models, this run's own record says how long a line takes better than recent calls do.
  const own = switched.changes.length ? null : ownPace(db, run, switched.definition, unitIds.length);
  return { ok: true as const, workflowId: run.workflowId, lines: unitIds.length, plan: own === null ? plan : { ...plan, pace: { ...plan.pace, seconds: own, unmeasured: [] } } };
}

/**
 * Seconds for `lines` more at this run's own pace: the time its AI requests took (failed and timed out ones too: they
 * held a slot as long as they ran), spread over its parallel requests, per line it finished. null under 3 lines.
 */
function ownPace(db: Db, run: Run, definition: Run['definition'], lines: number) {
  const finished = new Set(db.select({ id: s.runItems.subjectId }).from(s.runItems).where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['done', 'failed']))).all().map((row) => row.id)).size;
  if (finished < 3) return null;
  const calls = db.select({ started: s.aiCalls.startedAt, finished: s.aiCalls.finishedAt }).from(s.aiCalls).where(and(eq(s.aiCalls.kind, 'run'), eq(s.aiCalls.refId, run.id))).all().filter((call) => call.finished);
  if (!calls.length) return null;
  const busy = calls.reduce((sum, call) => sum + (call.finished!.getTime() - call.started.getTime()) / 1000, 0);
  const parallel = Math.max(1, definition.nodes.reduce((sum, node) => sum + (node.type === 'ai' ? node.config.concurrency : 0), 0));
  return Math.round((busy / parallel / finished) * lines);
}
