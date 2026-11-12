import { and, eq, inArray } from 'drizzle-orm';
import { badRequest } from '../refusal.ts';
import { isWholeScriptWorkflow, workflowInput, type AiNode, type RunLimits, type RunScope, type WorkflowDefinition } from '@loca/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { ItemData } from '../db/schema.ts';
import { resolveBudgets } from './node-budgets.ts';
import { snapshotWorkflowModels } from '../domain/model-target.ts';
import { expandedDefinition } from './expand-calls.ts';
import { subjectBatch } from './batches.ts';
import { subjectOf } from './subjects.ts';

/*
 * Creating a run (#22): storing it with its items and their plan — the part of a run that happens
 * before the Runner moves anything. Which items a scope names and how they are planned is the
 * subject's (subjects.ts). Kept out of runner.ts so preflight can plan a run without importing the
 * scheduler (and the scheduler can use preflight's overhead estimate).
 */

/**
 * The request a run of the whole script would put `subjectId` (a line, or a term) in at `node`: the ids of
 * that request's items, in request order. The run's own steps, not a copy of them (the subject's batchOf):
 * the items such a run takes, its plan where the subject has one, and the node's packing. `definition` is a
 * run's: calls expanded, budgets fixed. Null when such a run would not take the item. A run with a narrower
 * scope, or one whose lines reach the node at different times, can pack differently.
 */
export function batchOf(db: Db, projectId: string, definition: WorkflowDefinition, node: AiNode, subjectId: string): string[] | null {
  const subject = workflowInput(definition);
  return subjectOf(subject).batchOf(db, projectId, definition, subjectBatch(subject, node), subjectId);
}

type RunInput = { projectId: string; workflow: typeof s.workflows.$inferSelect; models: Record<string, s.AiSnapshot>; scope: RunScope; limits?: RunLimits; /** The conversation it starts from: hears its end. */ sessionId?: string | null };

/** The project's tags that the definition's exit actions name. */
function exitTags(db: Db, projectId: string, definition: WorkflowDefinition): s.RunTag[] {
  const ids = new Set(definition.nodes.flatMap((node) => Object.values(node.exits ?? {}).flat().flatMap((action) => (action.type === 'tag' ? [...action.tagIds, ...Object.values(action.categoryTags)] : []))));
  if (!ids.size) return [];
  return db.select({ id: s.tags.id, name: s.tags.name, color: s.tags.color, scope: s.tags.scope, description: s.tags.description }).from(s.tags).where(eq(s.tags.projectId, projectId)).all().filter((tag) => ids.has(tag.id));
}

/** The run's lines and their plan batches, and the run row to store. */
function runRows(db: Db, input: RunInput) {
  // Called workflows are put in place first: the run stores, plans and budgets the nodes it will really run.
  // "Auto" budgets are fixed here for the models this run calls: the plan and the runner use the same numbers.
  const definition = resolveBudgets(db, expandedDefinition(db, input.projectId, input.workflow.definition, input.workflow.id));
  const entry = definition.nodes.find((node) => node.type === 'entry');
  if (!entry) badRequest('진입 노드가 없습니다.');
  const subject = workflowInput(definition);
  const adapter = subjectOf(subject);
  const unitIds = adapter.select(db, input.projectId, input.scope);
  if (!unitIds.length) badRequest(adapter.nothingInScope);
  const runId = crypto.randomUUID();
  const plan = adapter.plan(db, definition, unitIds);
  const run = {
    id: runId,
    projectId: input.projectId,
    workflowId: input.workflow.id,
    workflowName: input.workflow.name,
    workflowVersion: input.workflow.version,
    definition,
    // Models of the nodes inside called workflows are frozen with the caller's.
    models: { ...snapshotWorkflowModels(db, definition), ...input.models },
    subject,
    scope: input.scope,
    status: 'running' as s.RunStatus,
    total: unitIds.length,
    limits: input.limits ?? null,
    sessionId: input.sessionId ?? null,
    // The tags its exit actions name, as they are now: one deleted while the run goes on is made again from these.
    tags: exitTags(db, input.projectId, definition),
  };
  const items = unitIds.map((unitId) => ({ runId, subjectId: unitId, nodeId: entry.id, state: 'queued' as const, visits: { [entry.id]: 1 }, data: { path: [], outputs: {} } as ItemData, plan: plan.get(unitId) ?? null }));
  return { run, items };
}

/** Creates a run with all its lines in one transaction (tests, scripts and small runs). */
export function createRun(db: Db, input: RunInput) {
  const { run, items } = runRows(db, input);
  db.transaction((tx) => {
    tx.insert(s.runs).values(run).run();
    for (let index = 0; index < items.length; index += 400) tx.insert(s.runItems).values(items.slice(index, index + 400)).run();
  });
  return { runId: run.id, total: run.total };
}

export const WHOLE_SCRIPT_BUSY = '대본 전체를 읽는 실행이 이미 진행 중입니다.';

/** The statuses of a run that is going: one still being stored (preparing) counts like one that runs. */
export const ACTIVE_RUN_STATUSES = ['preparing', 'running'] as const satisfies readonly s.RunStatus[];

/**
 * One whole-script run at a time per project, whoever starts it (run dialog, chat). `exceptRunId`:
 * the run being continued or resumed, which may go on itself.
 */
export function refuseSecondWholeScript(db: Db, projectId: string, exceptRunId?: string) {
  const runs = db.select({ id: s.runs.id, definition: s.runs.definition }).from(s.runs).where(and(eq(s.runs.projectId, projectId), inArray(s.runs.status, ACTIVE_RUN_STATUSES))).all();
  if (runs.some((run) => run.id !== exceptRunId && isWholeScriptWorkflow(run.definition))) badRequest(WHOLE_SCRIPT_BUSY);
}

/** Lines stored per step when a run is created from the app or a chat. */
const FILL_STEP = 2_000;

/**
 * createRun for the app and chats: a 50k-line run is stored FILL_STEP lines at a time with the
 * event loop handed back in between (one transaction took about a second, holding up every
 * request). The run is `preparing` until all its lines are in; cancelled meanwhile, it stops storing.
 */
export async function createRunInSteps(db: Db, input: RunInput) {
  // Checked and inserted with no await in between, so two starts at once cannot both pass.
  if (isWholeScriptWorkflow(expandedDefinition(db, input.projectId, input.workflow.definition, input.workflow.id))) refuseSecondWholeScript(db, input.projectId);
  const { run, items } = runRows(db, input);
  db.insert(s.runs).values({ ...run, status: 'preparing' }).run();
  const preparing = and(eq(s.runs.id, run.id), eq(s.runs.status, 'preparing'));
  for (let start = 0; start < items.length; start += FILL_STEP) {
    await new Promise((resolve) => setImmediate(resolve));
    const stored = db.transaction((tx) => {
      if (!tx.select({ id: s.runs.id }).from(s.runs).where(preparing).get()) return false;
      const part = items.slice(start, start + FILL_STEP);
      for (let index = 0; index < part.length; index += 400) tx.insert(s.runItems).values(part.slice(index, index + 400)).run();
      return true;
    });
    if (!stored) break;
  }
  db.update(s.runs).set({ status: 'running' }).where(preparing).run();
  return { runId: run.id, total: run.total };
}

export const UNPREPARED = '서버가 멈춰서 실행을 준비하다 말았습니다(대사를 다 넣지 못함). 새로 실행하세요.';

/**
 * Runs a server left `preparing` when it stopped: nothing will store the rest of their lines, so they can
 * never start. At startup they are closed (cancelled, with their lines), saying what happened.
 */
export function closeUnpreparedRuns(db: Db) {
  const left = db.select({ id: s.runs.id, projectId: s.runs.projectId }).from(s.runs).where(eq(s.runs.status, 'preparing')).all();
  for (const run of left) {
    db.transaction((tx) => {
      tx.update(s.runs).set({ status: 'cancelled', notice: UNPREPARED, finishedAt: new Date() }).where(eq(s.runs.id, run.id)).run();
      tx.update(s.runItems).set({ state: 'cancelled' }).where(and(eq(s.runItems.runId, run.id), inArray(s.runItems.state, ['queued', 'running']))).run();
    });
  }
  return left.length;
}
