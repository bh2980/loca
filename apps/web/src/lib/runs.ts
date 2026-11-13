import { useLiveQuery } from '@tanstack/react-db';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { client, unwrap } from './api';
import { liveRows, projectCollection, sent, type FeedRow } from './collections';
import { key } from './query-keys';

/**
 * The project's latest workflow runs with how many of their lines are in each state: one collection
 * the row feed keeps current, so a running run sends only its own row as its lines move.
 */
export type Run = FeedRow['runs'];

export const runsCollection = (projectId: string) => projectCollection('runs', projectId);

/** Runs, newest first. */
export function useRuns(projectId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return liveRows(useLiveQuery((query) => (enabled ? query.from({ run: runsCollection(projectId) }).orderBy(({ run }) => run.createdAt, 'desc') : undefined)), enabled);
}

type RunApi = (typeof client.runs)[':id'];
export type ContinueRequest = InferRequestType<RunApi['continue']['preflight']['$post']>['json'];

/** What continuing a paused or finished run would do (runs topic; calls imply it: it paces itself by the run's calls). */
export const continuePreflight = (runId: string, request: ContinueRequest) =>
  queryOptions({
    queryKey: key('runs', 'continue-preflight', runId, request),
    queryFn: () => unwrap(client.runs[':id'].continue.preflight.$post({ param: { id: runId }, json: request })),
    placeholderData: keepPreviousData,
  });

/** The batches a run was planned in. */
export const runPlan = (runId: string) => queryOptions({ queryKey: key('runs', 'plan', runId), queryFn: () => unwrap(client.runs[':id'].plan.$get({ param: { id: runId } })), staleTime: Infinity });

// ── writes: each done when the feed has brought the run's row ────────────────────

/** Continues a run, on other models for some AI steps and/or with its failed lines again, with new caps if given. */
export const continueRun = (projectId: string, runId: string, json: InferRequestType<RunApi['continue']['$post']>['json']) => sent(projectId, client.runs[':id'].continue.$post({ param: { id: runId }, json }));

/** Pauses, resumes or cancels a run; a resume may raise the caps that paused it. */
export const controlRun = (projectId: string, runId: string, action: 'pause' | 'resume' | 'cancel', limits?: unknown) =>
  sent(
    projectId,
    client.runs[':id'][':action{pause|resume|cancel}'].$post(
      { param: { id: runId, action } },
      // The route reads an optional body the typed client does not describe.
      limits === undefined ? undefined : { init: { body: JSON.stringify({ limits }), headers: { 'content-type': 'application/json' } } },
    ),
  );

/** 감시 끊기: the conversation stops following the run (it goes on). */
export const unwatchRun = (projectId: string, runId: string) => sent(projectId, client.runs[':id'].unwatch.$post({ param: { id: runId } }));
