import { and, eq } from 'drizzle-orm';
import { expandCalls, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/**
 * A workflow's definition with its 워크플로 호출 nodes replaced by the workflows they call (see
 * expandCalls), read from the project's saved workflows. What a run is planned, previewed and stored
 * with; a run that continues uses its stored (already expanded) definition. Throws the run-start error
 * when a call cannot be expanded. `workflowId`: the workflow the definition belongs to.
 */
export function expandedDefinition(db: Db, projectId: string, definition: WorkflowDefinition, workflowId?: string | null): WorkflowDefinition {
  if (!definition.nodes.some((node) => node.type === 'call')) return definition;
  return expandCalls(definition, (id) => db.select({ name: s.workflows.name, definition: s.workflows.definition }).from(s.workflows).where(and(eq(s.workflows.id, id), eq(s.workflows.projectId, projectId))).get(), { workflowId: workflowId ?? undefined });
}
