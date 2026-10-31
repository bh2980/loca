import { useLiveQuery } from '@tanstack/react-db';
import type { InferResponseType } from 'hono/client';
import type { client } from './api';
import { loaded, projectCollection } from './collections';

/**
 * The project's latest workflow runs with how many of their lines are in each state: one collection
 * the row feed keeps current, so a running run sends only its own row as its lines move.
 */
export type Run = InferResponseType<(typeof client.projects)[':projectId']['runs']['$get']>[number];

export const runsCollection = (projectId: string) => projectCollection<Run>('runs', projectId);

/** Runs, newest first. */
export function useRuns(projectId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return loaded<Run>(useLiveQuery((query) => (enabled ? query.from({ run: runsCollection(projectId) }).orderBy(({ run }) => run.createdAt, 'desc') : undefined)), enabled);
}
