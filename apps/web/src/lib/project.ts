import { useMemo } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { createOptimisticAction, useLiveQuery } from '@tanstack/react-db';
import type { InferRequestType, InferResponseType } from 'hono/client';
import { agentSettingsSchema, type SavedPrompt } from '@tw/shared';
import { ApiError, client, unwrap } from './api';
import { loaded, projectCollection, sent } from './collections';
import { useGroups } from './groups';
import { useTaxonomy } from './knowledge';

/**
 * The project's own row (its settings) and its progress. The row is a one-row collection the feed
 * reads again when a setting changes; the progress is summed in the browser from the scene rows (and
 * the status definitions), which the feed keeps current scene by scene. Kept apart so a line that
 * changes status does not redraw what only reads a setting (format rules, languages).
 */
type Api = (typeof client.projects)[':projectId'];
type Summary = InferResponseType<Api['$get']>;
export type Project = Omit<Summary, 'byStatus' | 'excludedCount' | 'groupCount' | 'reviewCount' | 'aiDecided' | 'editorCallsToday'>;
export type ProjectPatch = InferRequestType<Api['$patch']>['json'];

export const projectRow = (projectId: string) => projectCollection<Project>('project', projectId);

/** The project's settings (undefined until loaded). */
export function useProject(projectId: string | undefined) {
  const enabled = Boolean(projectId);
  const rows = loaded<Project>(useLiveQuery((query) => (enabled ? query.from({ project: projectRow(projectId!) }) : undefined)), enabled);
  return { ...rows, data: rows.data?.[0] };
}

/** For the project route's loader: the row is there, or the project does not exist (404). */
export async function loadProject(projectId: string) {
  const rows = projectRow(projectId);
  await rows.preload();
  if (!rows.has(projectId)) throw new ApiError('프로젝트를 찾을 수 없습니다.', 404);
}

/** Saves project settings: the row changes at once and the saved row replaces it from the feed; a refusal puts it back (and rejects). */
export function saveProject(projectId: string, patch: ProjectPatch) {
  const rows = projectRow(projectId);
  const run = createOptimisticAction<void>({
    onMutate: () => {
      if (rows.has(projectId)) rows.update(projectId, (draft) => void Object.assign(draft, patch));
    },
    mutationFn: async () => {
      await sent(projectId, client.projects[':projectId'].$patch({ param: { projectId }, json: patch }));
    },
  });
  return run().when('settled');
}

/** The project's saved instructions (the slash menu lists them). */
export function useProjectPrompts(projectId: string): SavedPrompt[] {
  const settings = useProject(projectId).data?.agentSettings;
  return useMemo(() => agentSettingsSchema.parse(settings ?? {}).prompts, [settings]);
}

/** Replaces the project's saved instructions (they live in its agent settings): shown at once, put back on failure. */
export function saveProjectPrompts(projectId: string, prompts: SavedPrompt[]) {
  const rows = projectRow(projectId);
  const run = createOptimisticAction<void>({
    onMutate: () => {
      if (rows.has(projectId)) rows.update(projectId, (draft) => void (draft.agentSettings = { ...(draft.agentSettings as object), prompts } as never));
    },
    mutationFn: async () => {
      await sent(projectId, client.projects[':projectId'].prompts.$put({ param: { projectId }, json: { prompts } }));
    },
  });
  return run().when('settled');
}

/**
 * The project's progress from its scene rows: lines for translation by status, 번역 제외 lines, scenes,
 * the review inbox (lines in a status marked 검토함), lines whose listener is unknown, and lines AI
 * decided by script kind (번역 제외 hidden, as their lists show them). Undefined until loaded.
 */
export function useProjectProgress(projectId: string) {
  const groups = useGroups(projectId);
  const { statuses } = useTaxonomy(projectId);
  return useMemo(() => {
    if (!groups.data || !statuses) return undefined;
    const byStatus: Record<string, number> = {};
    const aiDecided = { scene: 0, document: 0, ui: 0 };
    let excludedCount = 0;
    let unknownListeners = 0;
    for (const group of groups.data) {
      for (const [statusId, count] of Object.entries(group.statuses)) byStatus[statusId] = (byStatus[statusId] ?? 0) + count;
      excludedCount += group.excluded;
      unknownListeners += group.unknownListeners;
      aiDecided[group.kind] += group.aiDecided;
    }
    const inReview = new Set(statuses.filter((status) => status.inReview).map((status) => status.id));
    const reviewCount = Object.entries(byStatus).reduce((sum, [statusId, count]) => sum + (inReview.has(statusId) ? count : 0), 0);
    return { byStatus, excludedCount, groupCount: groups.data.length, reviewCount, unknownListeners, aiDecided };
  }, [groups.data, statuses]);
}

/** How many 에디터 AI completions the project made today (calls topic: each one is a call). */
export const editorCalls = (projectId: string) =>
  queryOptions({ queryKey: ['calls', 'editor-today', projectId], queryFn: () => unwrap(client.projects[':projectId']['editor-calls'].$get({ param: { projectId } })) });

type Speaker = { id: string; speaker: string | null; lines: number; character: string | null };
type Listener = { id: string; name: string; lines: number };

/** Each speaker key with its lines and the character it names, most lines first ('' = lines with no speaker). */
export function useSpeakers(projectId: string) {
  return loaded<Speaker>(useLiveQuery((query) => query.from({ speaker: projectCollection<Speaker>('speakers', projectId) }).orderBy(({ speaker }) => speaker.lines, 'desc')));
}

/** The known listeners, most lines first, and how many lines' listener is unknown (청자 모름, summed from the scene rows). */
export function useListeners(projectId: string) {
  const rows = loaded<Listener>(useLiveQuery((query) => query.from({ listener: projectCollection<Listener>('listeners', projectId) }).orderBy(({ listener }) => listener.lines, 'desc')));
  const progress = useProjectProgress(projectId);
  const data = useMemo(() => (rows.data && progress ? { listeners: rows.data.map(({ name, lines }) => ({ name, lines })), unknownCount: progress.unknownListeners } : undefined), [rows.data, progress]);
  return { data, isPending: !data };
}
