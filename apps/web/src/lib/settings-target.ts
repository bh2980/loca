import { queryOptions } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { client, unwrap } from '@/lib/api';
import { sent, type FeedRow } from '@/lib/collections';
import { key } from '@/lib/query-keys';

/** Whose settings a screen edits: one project's, or the home's defaults that a new project copies. */
export type SettingsTarget = { kind: 'project'; projectId: string } | { kind: 'app' };

/** The query-key scope of a target: the project id, or 'app'. */
export const targetScope = (target: SettingsTarget) => (target.kind === 'project' ? target.projectId : 'app');

const projectConnections = client.projects[':projectId'].connections;
export type ConnectionRow = FeedRow['connections'];
export type ConnectionCreate = InferRequestType<typeof projectConnections.$post>['json'];
export type ConnectionPatch = InferRequestType<(typeof projectConnections)[':id']['$patch']>['json'];

/**
 * The connections API of a target. Both mounts have the same sub-paths; the project one carries
 * its id in the path, so the typed client cannot be used as one union and each call branches here.
 */
function connectionsApi(target: SettingsTarget) {
  const project = target.kind === 'project';
  const projectId = project ? target.projectId : '';
  const pid = { projectId };
  const app = client.app.connections;
  const proj = projectConnections;
  return {
    create: (json: ConnectionCreate) => (project ? proj.$post({ param: pid, json }) : app.$post({ json })),
    locate: (json: { kind: string; executable?: string }) => (project ? proj.locate.$post({ param: pid, json }) : app.locate.$post({ json })),
    patch: (id: string, json: ConnectionPatch) => (project ? proj[':id'].$patch({ param: { ...pid, id }, json }) : app[':id'].$patch({ param: { id }, json })),
    remove: (id: string) => (project ? proj[':id'].$delete({ param: { ...pid, id } }) : app[':id'].$delete({ param: { id } })),
    putKey: (id: string, apiKey: string) => (project ? proj[':id'].key.$put({ param: { ...pid, id }, json: { apiKey } }) : app[':id'].key.$put({ param: { id }, json: { apiKey } })),
    deleteKey: (id: string) => (project ? proj[':id'].key.$delete({ param: { ...pid, id } }) : app[':id'].key.$delete({ param: { id } })),
    probe: (id: string) => (project ? proj[':id'].probe.$post({ param: { ...pid, id } }) : app[':id'].probe.$post({ param: { id } })),
    models: (id: string) => (project ? proj[':id'].models.$get({ param: { ...pid, id } }) : app[':id'].models.$get({ param: { id } })),
    loginStatus: (id: string) => (project ? proj[':id'].login.$get({ param: { ...pid, id } }) : app[':id'].login.$get({ param: { id } })),
    openLogin: (id: string) => (project ? proj[':id'].login.$post({ param: { ...pid, id } }) : app[':id'].login.$post({ param: { id } })),
  };
}

/**
 * What a screen does to connections of a target. A change (create, patch, a key, remove) is done once the feed has
 * brought the connection's row in the target's scope; asking the connection something (probe, login) only answers.
 */
export function connectionWrites(target: SettingsTarget) {
  const api = connectionsApi(target);
  const scope = targetScope(target);
  return {
    create: (json: ConnectionCreate) => sent(scope, api.create(json)),
    patch: (id: string, json: ConnectionPatch) => sent(scope, api.patch(id, json)),
    remove: (id: string) => sent(scope, api.remove(id)),
    putKey: (id: string, apiKey: string) => sent(scope, api.putKey(id, apiKey)),
    deleteKey: (id: string) => sent(scope, api.deleteKey(id)),
    /** Whether the connection answers (its address, key or executable). */
    probe: (id: string) => unwrap(api.probe(id)),
    loginStatus: (id: string) => unwrap(api.loginStatus(id)),
    /** Opens the CLI's own login on this computer. */
    openLogin: (id: string) => unwrap(api.openLogin(id)),
  };
}

/** A connection's models, as it lists them (APIs can list hundreds; CLIs may list none). */
export const connectionModels = (target: SettingsTarget, connectionId: string) =>
  queryOptions({ queryKey: key('connections', 'models', targetScope(target), connectionId), queryFn: () => unwrap(connectionsApi(target).models(connectionId)) });

/** Where a CLI connection's executable is on this computer (the one typed, or the kind's own name). */
export const locatedExecutable = (target: SettingsTarget, kind: string, executable: string) =>
  queryOptions({ queryKey: key('connections', 'locate', targetScope(target), kind, executable), queryFn: () => unwrap(connectionsApi(target).locate({ kind, executable: executable || undefined })), staleTime: 30_000 });

type TestInput = InferRequestType<(typeof client.connections)[':id']['test']['$post']>['json'];
/**
 * A test translation through a connection's model. A question asked of the model, answered in place; the call it
 * logs is a row of the AI log, which the list of tests reads from its own collection (lib/ai-calls.ts).
 */
export const testConnection = (connectionId: string, json: TestInput) => unwrap(client.connections[':id'].test.$post({ param: { id: connectionId }, json }));
