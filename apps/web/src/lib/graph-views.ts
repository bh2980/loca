import { queryOptions } from '@tanstack/react-query';
import { useLiveQuery } from '@tanstack/react-db';
import type { InferRequestType } from 'hono/client';
import { client, unwrap } from './api';
import { liveRows, projectCollection, sent } from './collections';
import { key } from './query-keys';

/**
 * A project's saved graph views: their list is a collection the row feed keeps current; what one view holds
 * (its nodes laid out) is the graph's own question, asked again when the graph topic changes (a view's nodes are
 * graph rows: adding to, taking from or deleting a view changes that topic).
 */

type ViewsApi = (typeof client.projects)[':projectId']['graph']['views'];

/** Saved views, last changed first. */
export function useGraphViews(projectId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return liveRows(useLiveQuery((query) => (enabled ? query.from({ view: projectCollection('graphViews', projectId) }).orderBy(({ view }) => view.updatedAt, 'desc') : undefined)), enabled);
}

/** What a view holds, laid out (also a view made in the chat: show_graph). */
export const graphView = (projectId: string, id: string) =>
  queryOptions({ queryKey: key('graph', 'view', projectId, id), queryFn: () => unwrap(client.projects[':projectId'].graph.views[':id'].$get({ param: { projectId, id } })), staleTime: Infinity });

// ── writes: each done when the feed has brought the view's row ───────────────────

/** A view of nodes picked in the graph, or of one reading route (the view holds that route's nodes). */
export const createGraphView = (projectId: string, json: InferRequestType<ViewsApi['$post']>['json']) => sent(projectId, client.projects[':projectId'].graph.views.$post({ param: { projectId }, json }));
/** Renames a view and/or adds and removes nodes. */
export const changeGraphView = (projectId: string, id: string, json: Partial<InferRequestType<ViewsApi[':id']['$patch']>['json']>) =>
  sent(projectId, client.projects[':projectId'].graph.views[':id'].$patch({ param: { projectId, id }, json: { add: [], remove: [], ...json } }));
export const deleteGraphView = (projectId: string, id: string) => sent(projectId, client.projects[':projectId'].graph.views[':id'].$delete({ param: { projectId, id } }));
