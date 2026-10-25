import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { runModelsSchema, withRunModels, workflowInput, type WorkflowDefinition } from '@tw/shared';
import type { z } from 'zod';
import { badRequest, found } from '../context.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRunInSteps } from '../engine/run-create.ts';
import { scopeMismatch } from './run-plan.ts';
import { snapshotWorkflowModels } from './routes.ts';
import { calledWorkflowErrors, workflowIssues } from './workflow-issues.ts';

/** A scope that does not fit the workflow's input (line scenes for terms, the other input's marks…) is refused. */
export const fitScope = (definition: WorkflowDefinition, scope: s.RunScope) => {
  const mismatch = scopeMismatch(workflowInput(definition), scope);
  if (mismatch) badRequest(mismatch);
};

/**
 * Starts a run of a saved workflow: the run dialog's POST /workflows/:id/runs and the chat's run
 * card share it. This run's models (the dialog's picks) stand in for the nodes' own; the workflow
 * is not changed. Refused (400) when the scope, the workflow or a workflow it calls has errors.
 */
export async function startWorkflowRun(db: Db, workflowId: string, input: { scope: s.RunScope; models?: z.infer<typeof runModelsSchema>; limits?: { maxCalls?: number; maxInputTokens?: number } }) {
  const stored = found(db.select().from(s.workflows).where(eq(s.workflows.id, workflowId)).get(), '워크플로');
  const scope = { ...input.scope };
  fitScope(stored.definition, scope);
  const workflow = { ...stored, definition: withRunModels(stored.definition, input.models) };
  const errors = workflowIssues(db, workflow.projectId, workflow.definition, workflow.id).filter((issue) => issue.level === 'error');
  if (errors.length) badRequest(`워크플로에 오류가 ${errors.length}개 있습니다: ${errors[0].message}`);
  try {
    const called = calledWorkflowErrors(db, workflow.projectId, workflow.definition, workflow.id);
    if (called.length) badRequest(`부르는 워크플로에 오류가 ${called.length}개 있습니다: ${called[0]}`);
    return await createRunInSteps(db, { projectId: workflow.projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope, limits: input.limits });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    badRequest(error instanceof Error ? error.message : String(error));
  }
}
