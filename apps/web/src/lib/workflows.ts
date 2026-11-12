import { useMemo } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { client, unwrap } from './api';
import { liveRows, projectCollection, sent } from './collections';
import { key } from './query-keys';


export const workflowsCollection = (projectId: string) => projectCollection('workflows', projectId);

/** Workflows by name. */
export function useWorkflows(projectId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return liveRows(useLiveQuery((query) => (enabled ? query.from({ workflow: workflowsCollection(projectId) }).orderBy(({ workflow }) => workflow.name) : undefined)), enabled);
}

/** One workflow, whole (the editor): undefined until loaded or for none. */
export function useWorkflow(projectId: string, workflowId: string) {
  const all = useWorkflows(projectId);
  const data = useMemo(() => all.data?.find((workflow) => workflow.id === workflowId), [all.data, workflowId]);
  return { ...all, data };
}

// ── questions ──────────────────────────────────────────────────────────────────

type WorkflowApi = (typeof client.workflows)[':id'];
export type RunRequest = InferRequestType<WorkflowApi['preflight']['$post']>['json'];
export type RunStart = InferRequestType<WorkflowApi['runs']['$post']>['json'];

/**
 * What starting a workflow on a scope would do: its lines, requests and cost (keyed under units: it counts lines,
 * and through IMPLIES it follows the workflow, the glossary, the knowledge and the connections it reads).
 */
export const runPreflight = (workflowId: string, request: RunRequest) =>
  queryOptions({
    queryKey: key('units', 'run-preflight', workflowId, request),
    queryFn: () => unwrap(client.workflows[':id'].preflight.$post({ param: { id: workflowId }, json: request })),
    placeholderData: keepPreviousData,
  });

/**
 * The request one saved AI node would send for `sample` (a line key, or a term id; none = the first item): built by
 * the code a run uses. Asked again when the workflow or anything a line's request reads changes (IMPLIES: units → workflows).
 */
export const requestPreview = (workflowId: string, nodeId: string, sample: string | undefined) =>
  queryOptions({
    queryKey: key('workflows', 'request-preview', workflowId, nodeId, sample ?? ''),
    queryFn: () => unwrap(client.workflows[':id'].nodes[':nodeId'].request.$get({ param: { id: workflowId, nodeId }, query: sample ? { sample } : {} })),
    placeholderData: keepPreviousData,
  });

/** What is wrong with a definition not saved yet (the editor checks its draft as it is edited). */
export const validateWorkflow = (workflowId: string, definition: InferRequestType<WorkflowApi['validate']['$post']>['json']['definition']) =>
  unwrap(client.workflows[':id'].validate.$post({ param: { id: workflowId }, json: { definition } }));

// ── writes: each done when the feed has brought the workflow's row ───────────────

export const createWorkflow = (projectId: string, template?: string) => sent(projectId, client.projects[':projectId'].workflows.$post({ param: { projectId }, json: template ? { template } : {} }));
export const duplicateWorkflow = (projectId: string, id: string) => sent(projectId, client.workflows[':id'].duplicate.$post({ param: { id }, json: {} }));
export const deleteWorkflow = (projectId: string, id: string) => sent(projectId, client.workflows[':id'].$delete({ param: { id } }));
/** Saves a workflow over the version the edit began from; refused when it has moved on. The saved row is in the feed when this resolves, so its version is the one the next edit builds on. */
export const saveWorkflow = (projectId: string, id: string, json: InferRequestType<WorkflowApi['$put']>['json']) => sent(projectId, client.workflows[':id'].$put({ param: { id }, json }));

/** Starts a run of the workflow: done once the runs list has it. */
export const startRun = (projectId: string, workflowId: string, json: RunStart) => sent(projectId, client.workflows[':id'].runs.$post({ param: { id: workflowId }, json }));

/** A test call of an HTTP node as configured (nothing is saved). */
export const testHttpNode = (projectId: string, params: InferRequestType<(typeof client.projects)[':projectId']['http-test']['$post']>['json']['params']) =>
  unwrap(client.projects[':projectId']['http-test'].$post({ param: { projectId }, json: { params } }));
/** A test run of a script node's code on a sample (nothing is saved). */
export const testScriptNode = (projectId: string, json: InferRequestType<(typeof client.projects)[':projectId']['script-test']['$post']>['json']) =>
  unwrap(client.projects[':projectId']['script-test'].$post({ param: { projectId }, json }));
