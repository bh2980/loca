import { createOptimisticAction, useLiveQuery } from '@tanstack/react-db';
import type { InferRequestType, InferResponseType } from 'hono/client';
import { APP_FEED } from '@tw/shared';
import { client } from './api';
import { appCollection, loaded, projectCollection, sent } from './collections';
import { targetScope, type ConnectionRow, type SettingsTarget } from './settings-target';

/**
 * What belongs to the app rather than one project, from collections the row feed keeps current under its
 * app scope (0118): the projects list, the home's defaults (one row) and connections (the home's, or a
 * project's own in that project's scope).
 */
export type ProjectListRow = InferResponseType<typeof client.projects.$get>[number];
export type AppDefaults = InferResponseType<typeof client.app.defaults.$get> & { id: string };
export type AppDefaultsPatch = InferRequestType<typeof client.app.defaults.$patch>['json'];

const projectsList = () => appCollection<ProjectListRow>('projects');
const defaultsRow = () => appCollection<AppDefaults>('appDefaults');

/** The projects, last changed first. */
export function useProjects() {
  return loaded<ProjectListRow>(useLiveQuery((query) => query.from({ project: projectsList() }).orderBy(({ project }) => project.updatedAt, 'desc')));
}

/** The home's defaults (undefined until loaded, or while not `enabled`). */
export function useAppDefaults({ enabled = true }: { enabled?: boolean } = {}) {
  const rows = loaded<AppDefaults>(useLiveQuery((query) => (enabled ? query.from({ defaults: defaultsRow() }) : undefined)), enabled);
  return { ...rows, data: rows.data?.[0] };
}

/** Replaces the sections given: shown at once, put back on failure, done once the feed brings the saved row. */
export function saveAppDefaults(patch: AppDefaultsPatch) {
  const rows = defaultsRow();
  const run = createOptimisticAction<void>({
    onMutate: () => {
      if (rows.has('defaults')) rows.update('defaults', (draft) => void Object.assign(draft, patch));
    },
    mutationFn: async () => {
      await sent(APP_FEED, client.app.defaults.$patch({ json: patch }));
    },
  });
  return run().when('settled');
}

/** The connections of a project or of the home, by name. */
export function useConnections(target: SettingsTarget) {
  const scope = targetScope(target);
  const rows = scope === APP_FEED ? appCollection<ConnectionRow>('connections') : projectCollection<ConnectionRow>('connections', scope);
  return loaded<ConnectionRow>(useLiveQuery((query) => query.from({ connection: rows }).orderBy(({ connection }) => connection.name)));
}

/** A request that changes a connection: done once the feed has brought its row (in the target's scope). */
export function changeConnection<T extends Response & { json(): Promise<unknown> }>(target: SettingsTarget, request: Promise<T>) {
  return sent(targetScope(target), request);
}
