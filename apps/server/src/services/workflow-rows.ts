import { asc, eq } from 'drizzle-orm';
import { nodeName, workflowInput } from '@tw/shared';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { workflowIssues } from './workflow-issues.ts';
import { workflowCallers } from './workflow-mutations.ts';

/**
 * The project's workflows by name, each whole: its definition, what it takes in (lines or terms), its
 * size, its AI nodes (for pickers that show what one of them sends), what its checks find (they read
 * statuses, tags and connections, so those changes reach it too) and the workflows that call it (the
 * editor's header). The list and the editor read the same row.
 */
export function workflowRows(db: Db, projectId: string) {
  return db
    .select()
    .from(s.workflows)
    .where(eq(s.workflows.projectId, projectId))
    .orderBy(asc(s.workflows.name))
    .all()
    .map((row) => {
      const issues = workflowIssues(db, projectId, row.definition, row.id);
      return {
        ...row,
        input: workflowInput(row.definition),
        nodeCount: row.definition.nodes.length,
        aiNodes: row.definition.nodes.filter((node) => node.type === 'ai').map((node) => ({ id: node.id, name: nodeName(node) })),
        issues,
        errorCount: issues.filter((issue) => issue.level === 'error').length,
        calledBy: workflowCallers(db, projectId, row.id),
      };
    });
}
