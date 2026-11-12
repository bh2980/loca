import { useCallback } from 'react';
import { createOptimisticAction, useLiveQuery } from '@tanstack/react-db';
import type { InferRequestType } from 'hono/client';
import { APP_FEED, CONNECTION_KIND_INFO } from '@tw/shared';
import { client } from './api';
import { appCollection, liveRows, projectCollection, sent, type FeedRow } from './collections';
import { targetScope, type SettingsTarget } from './settings-target';

/**
 * What belongs to the app rather than one project, from collections the row feed keeps current under its
 * app scope (0118): the projects list, the home's defaults (one row) and connections (the home's, or a
 * project's own in that project's scope).
 */
export type ProjectListRow = FeedRow['projects'];
export type AppDefaults = FeedRow['appDefaults'];
export type AppDefaultsPatch = InferRequestType<typeof client.app.defaults.$patch>['json'];

const projectsList = () => appCollection('projects');
const defaultsRow = () => appCollection('appDefaults');

/** The projects, last changed first. */
export function useProjects() {
  return liveRows(useLiveQuery((query) => query.from({ project: projectsList() }).orderBy(({ project }) => project.updatedAt, 'desc')));
}

/** The home's defaults (undefined until loaded, or while not `enabled`). */
export function useAppDefaults({ enabled = true }: { enabled?: boolean } = {}) {
  const rows = liveRows(useLiveQuery((query) => (enabled ? query.from({ defaults: defaultsRow() }) : undefined)), enabled);
  return { ...rows, data: rows.data?.[0] };
}

/** 프로필: the person as the app shows them (the sidebar, a line's 이력): their name or '사람', its first letter, their colour. */
export function useProfile() {
  const defaults = useAppDefaults().data;
  const name = defaults?.displayName ?? '';
  return { name, label: name || '사람', mark: [...(name || '사람')][0]!, color: defaults?.avatarColor || null, loaded: Boolean(defaults) };
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
  const rows = scope === APP_FEED ? appCollection('connections') : projectCollection('connections', scope);
  return liveRows(useLiveQuery((query) => query.from({ connection: rows }).orderBy(({ connection }) => connection.name)));
}

/** A connection's name for rows that name it by id and kind (the AI log): a deleted one reads as its kind, null when neither is known. */
export function useConnectionName(target: SettingsTarget) {
  const { data } = useConnections(target);
  return useCallback((id: string | null, kind: string | null) => (id && data?.find((row) => row.id === id)?.name) || (kind ? (CONNECTION_KIND_INFO[kind as keyof typeof CONNECTION_KIND_INFO]?.label ?? kind) : null), [data]);
}
