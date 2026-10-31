import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { createOptimisticAction, useLiveQuery } from '@tanstack/react-db';
import type { InferResponseType } from 'hono/client';
import { APP_FEED } from '@tw/shared';
import { client, unwrap } from './api';
import { loaded, projectCollection, sent } from './collections';
import { heldCollection, useHeld, type Held } from './units';

/**
 * A project's saved graph views (their list; what one holds is the graph's own question), its
 * conversations with their model use, and the AI log. The log is long, so the browser holds the calls a
 * list shows: which ones is a question (calls topic), the calls come from a collection read again when
 * the feed names them (0119) or their connection is renamed. Model tests have no project: they are held
 * under the app's scope.
 */
export type GraphViewRow = InferResponseType<(typeof client.projects)[':projectId']['graph']['views']['$get']>[number];
export type ChatSessionRow = InferResponseType<(typeof client.projects)[':projectId']['chat']['$get']>[number];
export type AiCall = InferResponseType<(typeof client.projects)[':projectId']['ai-calls']['by-ids']['$post']>['rows'][number];

/** Saved views, last changed first. */
export function useGraphViews(projectId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return loaded<GraphViewRow>(useLiveQuery((query) => (enabled ? query.from({ view: projectCollection<GraphViewRow>('graphViews', projectId) }).orderBy(({ view }) => view.updatedAt, 'desc') : undefined)), enabled);
}

export const chatSessionsCollection = (projectId: string) => projectCollection<ChatSessionRow>('chatSessions', projectId);

/** Conversations, last changed first. */
export function useChatSessions(projectId: string) {
  return loaded<ChatSessionRow>(useLiveQuery((query) => query.from({ session: chatSessionsCollection(projectId) }).orderBy(({ session }) => session.updatedAt, 'desc')));
}

const logs = new Map<string, Held<AiCall>>();

function callsOf(scope: string) {
  let held = logs.get(scope);
  if (!held) {
    held = heldCollection<AiCall>({
      id: `ai-calls:${scope}`,
      projectId: scope,
      read: (ids) =>
        scope === APP_FEED
          ? unwrap(client.app['ai-calls']['by-ids'].$post({ json: { ids } }))
          : unwrap(client.projects[':projectId']['ai-calls']['by-ids'].$post({ param: { projectId: scope }, json: { ids } })),
      signal: (rows) => rows.aiCalls,
      // A call shows its connection's name.
      staleBy: (rows) => {
        const renamed = new Set(((rows.connections?.upsert ?? []) as { id: string }[]).map((row) => row.id));
        return renamed.size ? (call) => call.connectionId !== null && renamed.has(call.connectionId) : undefined;
      },
    });
    logs.set(scope, held);
  }
  return held;
}

/** The project's model requests for one job (a run, a chat), newest first, the latest 200. */
export function useJobCalls(projectId: string, ref: string) {
  const page = useQuery(
    queryOptions({
      queryKey: ['calls', projectId, 'ids', ref],
      queryFn: () => unwrap(client.projects[':projectId']['ai-calls'].ids.$get({ param: { projectId }, query: { ref } })),
      placeholderData: keepPreviousData,
    }),
  );
  return { data: useHeld(callsOf(projectId), page.data?.ids).rows };
}

/** A connection's latest model tests, newest first. */
export function useConnectionTests(connectionId: string) {
  const page = useQuery(
    queryOptions({
      queryKey: ['calls', 'tests', connectionId],
      queryFn: () => unwrap(client.connections[':id'].tests.ids.$get({ param: { id: connectionId } })),
      placeholderData: keepPreviousData,
    }),
  );
  return { data: useHeld(callsOf(APP_FEED), page.data?.ids).rows };
}

/** Changes a conversation's row (title, permission mode, model): shown at once, put back on failure, done once the feed brings it. */
export function changeChatSession<T extends Response & { json(): Promise<unknown> }>(projectId: string, sessionId: string, change: Partial<ChatSessionRow>, request: () => Promise<T>) {
  const rows = chatSessionsCollection(projectId);
  const run = createOptimisticAction<void>({
    onMutate: () => {
      if (rows.has(sessionId)) rows.update(sessionId, (draft) => void Object.assign(draft, change));
    },
    mutationFn: async () => {
      await sent(projectId, request());
    },
  });
  return run().when('settled');
}
