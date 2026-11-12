import { useMemo } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { loaded, projectCollection, type FeedRow } from './collections';

/**
 * The project's scenes, documents and UI groups with their progress (lines by status, 번역 제외,
 * 청자 모름): one collection the row feed keeps current, so a line that changes status sends only its
 * scene's row again.
 */
export type Group = FeedRow['groups'];

export const groupsCollection = (projectId: string) => projectCollection('groups', projectId);

/** Groups in script order; `kind` and `q` (title or key, case aside) narrow them. */
export function useGroups(projectId: string, { kind, q, enabled = true }: { kind?: Group['kind']; q?: string; enabled?: boolean } = {}) {
  const all = loaded<Group>(useLiveQuery((query) => (enabled ? query.from({ group: groupsCollection(projectId) }).orderBy(({ group }) => group.sort) : undefined)), enabled);
  const needle = q?.trim().toLowerCase();
  const data = useMemo(() => (kind || needle ? all.data?.filter((group) => (!kind || group.kind === kind) && (!needle || group.title.toLowerCase().includes(needle) || group.key.toLowerCase().includes(needle))) : all.data), [all.data, kind, needle]);
  return { ...all, data };
}

/** The project's groups by id: what a line (it names its scene by id) is joined with for the scene's title, section and kind. */
export function useGroupsById(projectId: string) {
  const { data } = useGroups(projectId);
  return useMemo(() => new Map((data ?? []).map((group) => [group.id, group] as const)), [data]);
}

/** One group (undefined until loaded, or for none). */
export function useGroup(projectId: string, groupId: string | undefined) {
  const groups = useGroups(projectId, { enabled: Boolean(groupId) });
  const data = useMemo(() => groups.data?.find((group) => group.id === groupId), [groups.data, groupId]);
  return { ...groups, data };
}
