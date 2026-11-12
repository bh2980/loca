import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { APP_FEED } from '@loca/shared';
import { client, unwrap } from './api';
import type { FeedRow } from './collections';
import { heldFeed, useHeld, type Held } from './held';
import { key } from './query-keys';

/**
 * The AI log. It is long, so the browser holds the calls a list shows: which ones is a question (calls topic), the
 * calls come from a collection read again when the feed names them. A call names its connection by id: the name is
 * the connections collection's. Model tests have no project: they are held under the app's scope.
 */
export type AiCall = FeedRow['aiCalls'];

const logs = new Map<string, Held<AiCall>>();

function callsOf(scope: string) {
  let held = logs.get(scope);
  if (!held) {
    held = heldFeed('aiCalls', scope);
    logs.set(scope, held);
  }
  return held;
}

/** The project's model requests for one job (a run, a chat), newest first, the latest 200. */
export function useJobCalls(projectId: string, ref: string) {
  const page = useQuery(
    queryOptions({
      queryKey: key('calls', 'ids', projectId, ref),
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
      queryKey: key('calls', 'tests', connectionId),
      queryFn: () => unwrap(client.connections[':id'].tests.ids.$get({ param: { id: connectionId } })),
      placeholderData: keepPreviousData,
    }),
  );
  return { data: useHeld(callsOf(APP_FEED), page.data?.ids).rows };
}

/** What one model request sent (kept for whole-script reads and glossary fills): written once, never changed. */
export const aiCallRequest = (projectId: string, id: string) =>
  queryOptions({ queryKey: key('calls', 'request', projectId, id), queryFn: () => unwrap(client.projects[':projectId']['ai-calls'][':id'].request.$get({ param: { projectId, id } })), staleTime: Infinity });
