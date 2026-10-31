import { useLiveQuery } from '@tanstack/react-db';
import type { InferResponseType } from 'hono/client';
import type { client } from './api';
import { loaded, projectCollection } from './collections';

/**
 * The project's workflows as the list shows them (what each takes in, its AI nodes, how many errors its
 * checks find): a collection the server computes again when a workflow, a status, a tag or a connection
 * changes, sending only the workflows whose row differs.
 */
export type WorkflowRow = InferResponseType<(typeof client.projects)[':projectId']['workflows']['$get']>[number];

export const workflowsCollection = (projectId: string) => projectCollection<WorkflowRow>('workflows', projectId);

/** Workflows by name. */
export function useWorkflows(projectId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return loaded<WorkflowRow>(useLiveQuery((query) => (enabled ? query.from({ workflow: workflowsCollection(projectId) }).orderBy(({ workflow }) => workflow.name) : undefined)), enabled);
}
