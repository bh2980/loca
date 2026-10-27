import type { InferRequestType, InferResponseType } from 'hono/client';
import { client } from '@/lib/api';

/** Whose settings a screen edits: one project's, or the home's defaults that a new project copies. */
export type SettingsTarget = { kind: 'project'; projectId: string } | { kind: 'app' };

/** The query-key scope of a target: the project id, or 'app'. */
export const targetScope = (target: SettingsTarget) => (target.kind === 'project' ? target.projectId : 'app');

const projectConnections = client.projects[':projectId'].connections;
export type ConnectionRow = InferResponseType<typeof projectConnections.$get>[number];
export type ConnectionCreate = InferRequestType<typeof projectConnections.$post>['json'];
export type ConnectionPatch = InferRequestType<(typeof projectConnections)[':id']['$patch']>['json'];

/**
 * The connections API of a target. Both mounts have the same sub-paths; the project one carries
 * its id in the path, so the typed client cannot be used as one union and each call branches here.
 */
export function connectionsApi(target: SettingsTarget) {
  const project = target.kind === 'project';
  const projectId = project ? target.projectId : '';
  const pid = { projectId };
  const app = client.app.connections;
  const proj = projectConnections;
  return {
    list: () => (project ? proj.$get({ param: pid }) : app.$get()),
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
