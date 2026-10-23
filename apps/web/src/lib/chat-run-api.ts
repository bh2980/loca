import { client, unwrap } from './api';
import type { RunApi, RunPlanLike, RunScope } from './chat-run';

/** The chat's run card talks to the same endpoints as the run dialog (preflight, start) and the server's reading of the picks as a scope. */
export const runApi = (projectId: string): RunApi => ({
  scope: async (workflowId, items) => (await unwrap(client.projects[':projectId'].chat['run-scope'].$post({ param: { projectId }, json: { workflowId, items } }))) as { input: 'lines' | 'terms'; scope: RunScope },
  preflight: async (workflowId, scope) => (await unwrap(client.workflows[':id'].preflight.$post({ param: { id: workflowId }, json: scope }))) as unknown as RunPlanLike,
  start: async (workflowId, scope, limits) => {
    const run = await unwrap(client.workflows[':id'].runs.$post({ param: { id: workflowId }, json: { ...scope, ...(Object.keys(limits).length ? { limits } : {}) } }));
    return { runId: run.runId };
  },
});
