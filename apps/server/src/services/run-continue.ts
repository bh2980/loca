import { and, eq, inArray } from 'drizzle-orm';
import { choiceKey, isWholeScriptWorkflow, withRunModels, type AiNode, type RunCaps, type RunModels, type RunScope } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { refuseSecondWholeScript, WHOLE_SCRIPT_BUSY } from '../engine/run-create.ts';
import { withCaps } from '../engine/run-guards.ts';
import { wakeRun } from '../engine/run-wake.ts';
import { workflowIssues } from './workflow-issues.ts';
import { preflight } from '../engine/preflight.ts';
import { resolveRunModels, type RunModelInput } from './run-plan.ts';
import { snapshotChoices } from '../domain/model-target.ts';
import { subjectOf } from '../engine/subjects.ts';

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
  // The run's items as they are: by id, regardless of status.
  const scope: RunScope = subjectOf(run.subject).scopeOf(unitIds);
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

/** How a paused or finished run goes on. */
export interface ContinueInput {
  /** The project the run must be in (a tool's); unset: wherever the run is. */
  projectId?: string;
  /** Other models for some AI steps, from now on and for this run only: by node id, or by name (the CLI and the chat). */
  models?: RunModels;
  namedModels?: RunModelInput;
  /** Its failed lines go again, from the step they failed in. */
  retryFailed?: boolean;
  /** New caps first: a number sets one, null removes it, one not named stays. */
  limits?: RunCaps;
  /** The conversation that goes on with it: the run's end is reported there from now on. */
  sessionId?: string | null;
}

/**
 * Goes on with a paused or finished run: the run page's 재개 and 이어서, the chat's continue_run and
 * `loca runs continue` all come here. A paused run with nothing else asked just resumes. With other
 * models and/or its failed lines again it continues: the run's own definition and model snapshots change
 * from now on (the workflow does not; calls already made keep the connection they went out through), the
 * failed lines are queued at the step that failed them, and the continuation is recorded — failures before
 * it no longer count toward 연속 실패. The runner picks the run up at once (wakeRun).
 */
export function continueRun(db: Db, runId: string, input: ContinueInput = {}) {
  const refuse = (error: string) => ({ ok: false as const, error });
  const run = db.select().from(s.runs).where(eq(s.runs.id, runId)).get();
  if (!run || (input.projectId && run.projectId !== input.projectId)) return refuse('실행을 찾을 수 없습니다.');
  if (run.status === 'running') return refuse('실행 중에는 바꿀 수 없습니다. 먼저 일시정지하세요.');
  if (run.status === 'cancelled') return refuse('취소한 실행은 이어서 할 수 없습니다. 새로 실행하세요.');
  if (run.status === 'preparing') return refuse('아직 대사를 넣는 중입니다.');
  const unreadable = s.definitionProblem(run.definition);
  if (unreadable) return refuse(`이 실행의 워크플로 정의를 읽을 수 없습니다: ${unreadable}`);
  if (isWholeScriptWorkflow(run.definition)) {
    try {
      refuseSecondWholeScript(db, run.projectId, run.id);
    } catch {
      return refuse(`${WHOLE_SCRIPT_BUSY} 그 실행이 끝나거나 멈춘 뒤에 이어서 하세요.`);
    }
  }
  let models = input.models;
  if (input.namedModels) {
    // Node ids of the run's own definition (calls already expanded), as the run page's 다른 모델로 takes them.
    const picked = resolveRunModels(db, run.projectId, run.definition, input.namedModels);
    if (picked.unknown.length) return refuse(`찾지 못함: ${picked.unknown.join(', ')}`);
    models = picked.models;
  }
  const switched = switchedRun(db, run, models);
  if (!switched.ok) return switched;
  const retryFailed = input.retryFailed ?? false;
  const limits = withCaps(run.limits, input.limits);
  const session = input.sessionId ? { sessionId: input.sessionId } : {};

  if (run.status === 'paused' && !retryFailed && !switched.changes.length) {
    db.update(s.runs).set({ status: 'running', notice: null, limits, ...session }).where(eq(s.runs.id, run.id)).run();
    wakeRun(db, run.id);
    return { ok: true as const, resumed: true, retried: 0, changes: switched.changes };
  }

  const result = db.transaction((tx) => {
    let retried = 0;
    if (retryFailed) {
      // Failed lines, and lines a pause caught on their way through an error path (queued with a failure).
      const failed = tx
        .select()
        .from(s.runItems)
        .where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['failed', 'queued'])))
        .all()
        .filter((item) => item.state === 'failed' || item.data.error);
      // A line goes back to the node that failed it,
      // arriving there as for the first time so the workflow's retry path applies again.
      const known = new Set(switched.definition.nodes.map((node) => node.id));
      for (const item of failed) {
        const failedAt = item.data.error?.nodeId;
        const nodeId = failedAt && known.has(failedAt) ? failedAt : item.nodeId;
        tx.update(s.runItems)
          .set({ state: 'queued', nodeId, error: null, notBefore: null, visits: { ...item.visits, [nodeId]: 1 }, data: { ...item.data, retry: undefined, error: undefined } })
          .where(eq(s.runItems.id, item.id))
          .run();
      }
      retried = failed.length;
    }
    const open = tx.select({ id: s.runItems.id }).from(s.runItems).where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['queued', 'running']))).limit(1).all();
    if (!open.length) return refuse('이어서 처리할 대사가 없습니다.');
    const continuation: s.RunContinuation = { at: Date.now(), changes: switched.changes, retried };
    tx.update(s.runs)
      .set({ definition: switched.definition, models: switched.models, status: 'running', notice: null, finishedAt: null, continuations: [...run.continuations, continuation], limits, ...session })
      .where(eq(s.runs.id, run.id))
      .run();
    return { ok: true as const, resumed: false, retried, changes: switched.changes };
  });
  if (result.ok) wakeRun(db, run.id);
  return result;
}
