import { asc, eq } from 'drizzle-orm';
import { nodeName, workflowInput } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { workflowIssues } from './workflow-issues.ts';

/**
 * The project's workflows as the workflow list shows them, by name: what each takes in (lines or
 * terms), its size, its AI nodes (for pickers that show what one of them sends) and how many errors
 * its checks find (they read statuses, tags and connections, so those changes reach it too).
 */
export function workflowRows(db: Db, projectId: string) {
  return db
    .select()
    .from(s.workflows)
    .where(eq(s.workflows.projectId, projectId))
    .orderBy(asc(s.workflows.name))
    .all()
    .map(({ definition, ...row }) => ({
      ...row,
      input: workflowInput(definition),
      nodeCount: definition.nodes.length,
      aiNodes: definition.nodes.filter((node) => node.type === 'ai').map((node) => ({ id: node.id, name: nodeName(node) })),
      errorCount: workflowIssues(db, projectId, definition, row.id).filter((issue) => issue.level === 'error').length,
    }));
}
