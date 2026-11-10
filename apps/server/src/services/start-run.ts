import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { runModelsSchema, withRunModels, workflowInput, type WorkflowDefinition } from '@tw/shared';
import type { z } from 'zod';
import { badRequest, found } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRunInSteps } from '../engine/run-create.ts';
import { preflight } from './preflight.ts';
import { scopeMismatch } from './run-plan.ts';
import { snapshotWorkflowModels } from './routes.ts';
import { calledWorkflowErrors, workflowIssues } from './workflow-issues.ts';

/** A scope that does not fit the workflow's input (line scenes for terms, the other input's marks…) is refused. */
export const fitScope = (definition: WorkflowDefinition, scope: s.RunScope) => {
  const mismatch = scopeMismatch(workflowInput(definition), scope);
  if (mismatch) badRequest(mismatch);
};

/** Caps asked for a new run: a number sets one, null runs without it, left out takes the suggestion. */
export type AskedLimits = { maxCalls?: number | null; maxInputTokens?: number | null };

/**
 * The caps a run starts with, however it is started (run dialog, chat card, start_run from the chat or `loca runs start`):
 * the preflight's suggestion (expected requests and input ×1.3 plus room for the retry rules) unless asked otherwise.
 */
export async function runLimits(db: Db, workflow: Pick<typeof s.workflows.$inferSelect, 'id' | 'projectId' | 'definition'>, scope: s.RunScope, asked: AskedLimits = {}): Promise<s.RunLimits | undefined> {
  const suggested = asked.maxCalls === undefined || asked.maxInputTokens === undefined ? (await preflight(db, workflow, scope)).suggestedLimits : undefined;
  const pick = (key: keyof AskedLimits) => (asked[key] === undefined ? suggested?.[key] : asked[key] ?? undefined);
  const maxCalls = pick('maxCalls');
  const maxInputTokens = pick('maxInputTokens');
  return maxCalls || maxInputTokens ? { ...(maxCalls && { maxCalls }), ...(maxInputTokens && { maxInputTokens }) } : undefined;
}

/** Makes the run of a workflow already checked and given this run's models, with its caps (see runLimits). */
export async function startCheckedRun(db: Db, workflow: typeof s.workflows.$inferSelect, input: { scope: s.RunScope; limits?: AskedLimits; sessionId?: string | null }) {
  const limits = await runLimits(db, workflow, input.scope, input.limits);
  return createRunInSteps(db, { projectId: workflow.projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: input.scope, limits, sessionId: input.sessionId });
}

/**
 * Starts a run of a saved workflow: the run dialog's POST /workflows/:id/runs and the chat's run
 * card share it. This run's models (the dialog's picks) stand in for the nodes' own; the workflow
 * is not changed. Refused (400) when the scope, the workflow or a workflow it calls has errors.
 */
export async function startWorkflowRun(db: Db, workflowId: string, input: { scope: s.RunScope; models?: z.infer<typeof runModelsSchema>; limits?: AskedLimits; sessionId?: string | null }) {
  const stored = found(db.select().from(s.workflows).where(eq(s.workflows.id, workflowId)).get(), '워크플로');
  const scope = { ...input.scope };
  fitScope(stored.definition, scope);
  const workflow = { ...stored, definition: withRunModels(stored.definition, input.models) };
  const errors = workflowIssues(db, workflow.projectId, workflow.definition, workflow.id).filter((issue) => issue.level === 'error');
  if (errors.length) badRequest(`워크플로에 오류가 ${errors.length}개 있습니다: ${errors[0].message}`);
  try {
    const called = calledWorkflowErrors(db, workflow.projectId, workflow.definition, workflow.id);
    if (called.length) badRequest(`부르는 워크플로에 오류가 ${called.length}개 있습니다: ${called[0]}`);
    return await startCheckedRun(db, workflow, { scope, limits: input.limits, sessionId: input.sessionId });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    badRequest(error instanceof Error ? error.message : String(error));
  }
}
