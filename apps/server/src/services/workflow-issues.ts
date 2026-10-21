import { eq } from 'drizzle-orm';
import { runNodeName, validateWorkflow, workflowRefOf, type WorkflowDefinition } from '@tw/shared';
import { expandedDefinition } from '../engine/expand-calls.ts';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** A workflow's problems against this project's connections, statuses and tags (shown in the editor, refused at run start). */
export function workflowIssues(db: Db, projectId: string, definition: WorkflowDefinition, workflowId?: string) {
  const ids = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));
  return validateWorkflow(definition, {
    workflows: workflowRefsOf(db, projectId),
    workflowId,
    connections: new Map(db.select({ id: s.connections.id, kind: s.connections.kind }).from(s.connections).all().filter((row) => row.kind !== 'http').map((row) => [row.id, row.kind])),
    statusIds: ids(db.select({ id: s.statuses.id }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all()),
    tagIds: ids(db.select({ id: s.tags.id }).from(s.tags).where(eq(s.tags.projectId, projectId)).all()),
    toolConnectionIds: ids(db.select({ id: s.connections.id }).from(s.connections).where(eq(s.connections.kind, 'http')).all()),
  });
}

/** The project's saved workflows as validation and the call picker see them. */
export const workflowRefsOf = (db: Db, projectId: string) => db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().map(workflowRefOf);

/**
 * Errors inside the workflows a definition calls, found on the expanded definition a run would
 * use ("호출 이름 › 노드 이름: 메시지"); an empty list when it calls nothing. Throws like a run start
 * when a call cannot be expanded. Run start checks these after the workflow's own issues.
 */
export function calledWorkflowErrors(db: Db, projectId: string, definition: WorkflowDefinition, workflowId?: string): string[] {
  const expanded = expandedDefinition(db, projectId, definition, workflowId);
  if (expanded === definition) return [];
  return workflowIssues(db, projectId, expanded)
    .filter((issue) => issue.level === 'error' && issue.nodeId?.includes('/'))
    .map((issue) => {
      const node = expanded.nodes.find((candidate) => candidate.id === issue.nodeId);
      return `${node ? runNodeName(expanded, node) : issue.nodeId}: ${issue.message}`;
    });
}
