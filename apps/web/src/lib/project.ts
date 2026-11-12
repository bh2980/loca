import { useMemo } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { createOptimisticAction, useLiveQuery } from '@tanstack/react-db';
import type { InferRequestType } from 'hono/client';
import { agentSettingsSchema, APP_FEED, type AppDefaultSection, type DetectedCustomFormatRule, type DetectedFormatPreset, type FormatPreset, type SavedPrompt } from '@tw/shared';
import { ApiError, client, unwrap } from './api';
import { liveRows, projectCollection, sent, type FeedRow } from './collections';
import { key } from './query-keys';
import { useGroups } from './groups';
import { useTaxonomy } from './knowledge';

/**
 * The project's own row (its settings) and its progress. The row is a one-row collection the feed
 * reads again when a setting changes; the progress is summed in the browser from the scene rows (and
 * the status definitions), which the feed keeps current scene by scene. Kept apart so a line that
 * changes status does not redraw what only reads a setting (format rules, languages).
 */
type Api = (typeof client.projects)[':projectId'];
export type Project = FeedRow['project'];
export type ProjectPatch = InferRequestType<Api['$patch']>['json'];

export const projectRow = (projectId: string) => projectCollection('project', projectId);

/** The project's settings (undefined until loaded). */
export function useProject(projectId: string | undefined) {
  const enabled = Boolean(projectId);
  const rows = liveRows(useLiveQuery((query) => (enabled ? query.from({ project: projectRow(projectId!) }) : undefined)), enabled);
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
  queryOptions({ queryKey: key('calls', 'editor-today', projectId), queryFn: () => unwrap(client.projects[':projectId']['editor-calls'].$get({ param: { projectId } })) });

/** Each speaker key with its lines and the character it names, most lines first ('' = lines with no speaker). */
export function useSpeakers(projectId: string) {
  return liveRows(useLiveQuery((query) => query.from({ speaker: projectCollection('speakers', projectId) }).orderBy(({ speaker }) => speaker.lines, 'desc')));
}

/** The known listeners, most lines first, and how many lines' listener is unknown (청자 모름, summed from the scene rows). */
export function useListeners(projectId: string) {
  const rows = liveRows(useLiveQuery((query) => query.from({ listener: projectCollection('listeners', projectId) }).orderBy(({ listener }) => listener.lines, 'desc')));
  const progress = useProjectProgress(projectId);
  const data = useMemo(() => (rows.data && progress ? { listeners: rows.data.map(({ name, lines }) => ({ name, lines })), unknownCount: progress.unknownListeners } : undefined), [rows.data, progress]);
  return { data, isLoading: !data };
}

/** The format tokens the project's source seems to use, for the format rules' suggestions (units topic). */
export const detectedFormatRules = (projectId: string) =>
  queryOptions({
    queryKey: key('units', 'detect-format-rules', projectId),
    queryFn: () =>
      unwrap(client.projects[':projectId']['detect-format-rules'].$get({ param: { projectId } })) as Promise<{
        presets: DetectedFormatPreset[];
        customCandidates: DetectedCustomFormatRule[];
        recommendedPresets: FormatPreset[];
      }>,
  });

// ── writes on the project as a whole ───────────────────────────────────────────

/** Deletes the project: done once the projects list (the app's scope) has lost it. */
export const deleteProject = (projectId: string) => sent(APP_FEED, client.projects[':projectId'].$delete({ param: { projectId } }));

/** Checks a project file without importing it: what it holds and what is wrong with it. */
export const validateProjectFile = (body: unknown) => unwrap(client.projects.validate.$post({ json: body }));

/** A new project from a file: done once the projects list has it. */
export const importProjectFile = (data: unknown) => sent(APP_FEED, client.projects.$post({ json: data as never }));

/** 홈 기본값 가져오기: the checked sections of the home's defaults come into this project; answers with what each did. */
export const pullDefaults = (projectId: string, sections: AppDefaultSection[]) => sent(projectId, client.projects[':projectId'].defaults.pull.$post({ param: { projectId }, json: { sections } }));

/** 홈 기본값 올리기: this project's sections go up to the home's defaults (the app's scope). */
export const pushDefaults = (projectId: string, sections: AppDefaultSection[], workflowIds: string[]) => sent(APP_FEED, client.projects[':projectId'].defaults.push.$post({ param: { projectId }, json: { sections, workflowIds } }));

/** A regular expression written by the AI from a description: a question asked of the model (the call is logged; no row a screen edits changes). */
export const generateRegex = (projectId: string, prompt: string, target: InferRequestType<Api['generate-regex']['$post']>['json']['target']) =>
  unwrap(client.projects[':projectId']['generate-regex'].$post({ param: { projectId }, json: { prompt, target } }));
