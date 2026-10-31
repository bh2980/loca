import { useMemo } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import type { InferResponseType } from 'hono/client';
import type { client } from './api';
import { loaded, projectCollection } from './collections';

/**
 * The project's workflows, each whole (definition, what it takes in, its AI nodes, what its checks find,
 * who calls it): the list and the editor read one collection the server computes again when a workflow, a status, a tag or a connection
 * changes, sending only the workflows whose row differs.
 */
export type WorkflowRow = InferResponseType<(typeof client.projects)[':projectId']['workflows']['$get']>[number];

export const workflowsCollection = (projectId: string) => projectCollection<WorkflowRow>('workflows', projectId);

/** Workflows by name. */
export function useWorkflows(projectId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return loaded<WorkflowRow>(useLiveQuery((query) => (enabled ? query.from({ workflow: workflowsCollection(projectId) }).orderBy(({ workflow }) => workflow.name) : undefined)), enabled);
}

/** One workflow, whole (the editor): undefined until loaded or for none. */
export function useWorkflow(projectId: string, workflowId: string) {
  const all = useWorkflows(projectId);
  const data = useMemo(() => all.data?.find((workflow) => workflow.id === workflowId), [all.data, workflowId]);
  return { ...all, data };
}
