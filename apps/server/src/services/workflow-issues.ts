import { eq } from 'drizzle-orm';
import { validateWorkflow, type WorkflowDefinition } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';

/** A workflow's problems against this project's connections, statuses and tags (shown in the editor, refused at run start). */
export function workflowIssues(db: Db, projectId: string, definition: WorkflowDefinition) {
  const ids = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));
  return validateWorkflow(definition, {
    connections: new Map(db.select({ id: s.connections.id, kind: s.connections.kind }).from(s.connections).all().filter((row) => row.kind !== 'http').map((row) => [row.id, row.kind])),
    statusIds: ids(db.select({ id: s.statuses.id }).from(s.statuses).where(eq(s.statuses.projectId, projectId)).all()),
    tagIds: ids(db.select({ id: s.tags.id }).from(s.tags).where(eq(s.tags.projectId, projectId)).all()),
    toolConnectionIds: ids(db.select({ id: s.connections.id }).from(s.connections).where(eq(s.connections.kind, 'http')).all()),
  });
}
