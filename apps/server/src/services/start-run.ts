import { and, eq } from 'drizzle-orm';
import { runScopeInputSchema, withRunModels, workflowInput, type RunCaps, type RunLimits, type RunModels, type RunScope, type WorkflowDefinition } from '@tw/shared';
import { badRequest } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRunInSteps, selectRunTerms, selectRunUnits } from '../engine/run-create.ts';
import { preflight } from './preflight.ts';
import { askedScope, resolveRunModels, scopeMismatch, type RunModelInput } from './run-plan.ts';
import { snapshotWorkflowModels } from './routes.ts';
import { calledWorkflowErrors, workflowIssues } from './workflow-issues.ts';

/** A scope that does not fit the workflow's input (line scenes for terms, the other input's marks…) is refused. */
export const fitScope = (definition: WorkflowDefinition, scope: RunScope) => {
  const mismatch = scopeMismatch(workflowInput(definition), scope);
  if (mismatch) badRequest(mismatch);
};

/**
 * The caps a run starts with, however it is started (run dialog, chat card, start_run from the chat or `loca runs start`):
 * the preflight's suggestion (expected requests and input ×1.3 plus room for the retry rules) unless asked otherwise
 * (a number sets one, null runs without it).
 */
export async function runLimits(db: Db, workflow: Pick<typeof s.workflows.$inferSelect, 'id' | 'projectId' | 'definition'>, scope: RunScope, asked: RunCaps = {}): Promise<RunLimits | undefined> {
  const suggested = asked.maxCalls === undefined || asked.maxInputTokens === undefined ? (await preflight(db, workflow, scope)).suggestedLimits : undefined;
  const pick = (key: keyof RunCaps) => (asked[key] === undefined ? suggested?.[key] : asked[key] ?? undefined);
  const maxCalls = pick('maxCalls');
  const maxInputTokens = pick('maxInputTokens');
  return maxCalls || maxInputTokens ? { ...(maxCalls && { maxCalls }), ...(maxInputTokens && { maxInputTokens }) } : undefined;
}

/** What a run is started with, whoever starts it. */
export interface RunStart {
  workflowId: string;
  /** The project the workflow must be in (a tool's); unset: wherever the workflow is. */
  projectId?: string;
  /** What it runs on: as asked (names and ids, resolved here; a tool's stored input is read strictly), or a scope resolved before (a run card keeps the one its numbers were made with). */
  scope: { asked: unknown } | { resolved: RunScope };
  /** This run's models instead of the nodes' own: by node id, or by name (the CLI and the chat). */
  models?: RunModels;
  namedModels?: RunModelInput;
}

/**
 * What starting this run means, or why it cannot start: the saved workflow with this run's models, and a
 * scope that fits it, names only what the project has and holds something. The run dialog, the chat's run
 * card, the start_run tool and its proposal (which asks when it is made, so the card says what accepting
 * starts, and again when it runs) all ask here, so they refuse the same things in the same words.
 */
export function resolveRunStart(db: Db, input: RunStart) {
  const refuse = (error: string) => ({ ok: false as const, error });
  const stored = db.select().from(s.workflows).where(and(eq(s.workflows.id, input.workflowId), input.projectId ? eq(s.workflows.projectId, input.projectId) : undefined)).get();
  if (!stored) return refuse('워크플로를 찾을 수 없습니다.');
  const unreadable = s.definitionProblem(stored.definition);
  if (unreadable) return refuse(`'${stored.name}' 워크플로의 저장된 정의를 읽을 수 없습니다: ${unreadable}`);
  const projectId = stored.projectId;
  let models = input.models;
  if (input.namedModels) {
    const picked = resolveRunModels(db, projectId, stored.definition, input.namedModels);
    if (picked.unknown.length) return refuse(`찾지 못함: ${picked.unknown.join(', ')}`);
    models = picked.models;
  }
  const workflow = { ...stored, definition: withRunModels(stored.definition, models) };
  const subject = workflowInput(workflow.definition);
  let scope: RunScope;
  if ('resolved' in input.scope) {
    const mismatch = scopeMismatch(subject, input.scope.resolved);
    if (mismatch) return refuse(mismatch);
    scope = { ...input.scope.resolved };
  } else {
    // A condition this does not know is refused, never dropped (a stored proposal may be older than the schema).
    const asked = runScopeInputSchema.safeParse(input.scope.asked);
    if (!asked.success) return refuse(`범위가 맞지 않습니다: ${asked.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`.trim()).join('; ')}`);
    const resolved = askedScope(db, projectId, subject, asked.data);
    if (!resolved.ok) return resolved;
    scope = resolved.scope;
  }
  const errors = workflowIssues(db, projectId, workflow.definition, workflow.id).filter((issue) => issue.level === 'error');
  if (errors.length) return refuse(`워크플로에 오류가 ${errors.length}개 있습니다: ${errors[0]!.message}`);
  try {
    const called = calledWorkflowErrors(db, projectId, workflow.definition, workflow.id);
    if (called.length) return refuse(`부르는 워크플로에 오류가 ${called.length}개 있습니다: ${called[0]}`);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
  if (subject === 'terms' ? !selectRunTerms(db, projectId, scope).length : !selectRunUnits(db, projectId, scope).length) return refuse(subject === 'terms' ? '조건에 맞는 용어가 없습니다.' : '조건에 맞는 대사가 없습니다.');
  return { ok: true as const, workflow, subject, scope };
}

/**
 * Starts a run of a saved workflow (resolveRunStart), with its caps (runLimits). This run's models stand in for the
 * nodes' own; the workflow is not changed. `sessionId`: the conversation it starts from, which hears its end.
 */
export async function startRun(db: Db, input: RunStart & { limits?: RunCaps; sessionId?: string | null }) {
  const resolved = resolveRunStart(db, input);
  if (!resolved.ok) return resolved;
  const { workflow, scope } = resolved;
  try {
    const limits = await runLimits(db, workflow, scope, input.limits);
    const run = await createRunInSteps(db, { projectId: workflow.projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope, limits, sessionId: input.sessionId });
    return { ok: true as const, ...run, workflow: workflow.name };
  } catch (error) {
    // e.g. a whole-script run is already going (one at a time per project).
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}
