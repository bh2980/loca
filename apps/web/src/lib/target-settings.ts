import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { editorCalls, saveProject, saveProjectPrompts, useProject } from '@/lib/project';
import { toast } from 'sonner';
import { agentSettingsSchema, DEFAULT_EDITOR_AI, type AgentSettings, type EditorAi, type SavedPrompt } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';
import type { SettingsTarget } from '@/lib/settings-target';

export type SettingsPatch = { editorAi?: EditorAi; agentSettings?: AgentSettings; aiAutoConfirm?: boolean };

/**
 * Reads and saves the settings a project and the home's defaults share (editorAi, agentSettings,
 * aiAutoConfirm). A project reads its row (useProject) and saves through saveProject; the home reads
 * `q.appDefaults` and patches `/app/defaults`. The change shows at once and is put back on failure.
 */
export function useTargetSettings(target: SettingsTarget) {
  const queryClient = useQueryClient();
  const projectId = target.kind === 'project' ? target.projectId : undefined;
  const project = useProject(projectId);
  const app = useQuery({ ...q.appDefaults(), enabled: !projectId });
  const calls = useQuery({ ...editorCalls(projectId ?? ''), enabled: !!projectId });
  const data = projectId ? project.data : app.data;

  const save = useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      if (projectId) await saveProject(projectId, patch as never);
      else await unwrap(client.app.defaults.$patch({ json: patch as never }));
    },
    // The home's defaults are a query: shown at once, put back on failure (a project's row does this itself).
    onMutate: async (patch) => ({ undo: projectId ? undefined : await optimistic(queryClient, [{ key: q.appDefaults().queryKey, update: (old: object) => ({ ...old, ...patch }) }]) }),
    onError: (error, _patch, context) => {
      context?.undo?.();
      toast.error(error.message);
    },
  });

  return {
    loaded: !!data,
    editorAi: (data?.editorAi ?? DEFAULT_EDITOR_AI) as EditorAi,
    agentSettings: agentSettingsSchema.parse(data?.agentSettings ?? {}),
    aiAutoConfirm: data?.aiAutoConfirm ?? true,
    /** Project only: the editor's autocomplete calls made today. */
    editorCallsToday: calls.data?.today,
    save,
  };
}

/** The saved instructions of a target, inside its agent settings; a project saves them through their own endpoint (only the list changes). */
export function useTargetPrompts(target: SettingsTarget) {
  const projectId = target.kind === 'project' ? target.projectId : undefined;
  const settings = useTargetSettings(target);
  const list: SavedPrompt[] = settings.agentSettings.prompts;

  const saveProject = useMutation({
    mutationFn: (next: SavedPrompt[]) => saveProjectPrompts(projectId!, next),
    onSuccess: () => toast.success('저장한 지시를 저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  const saveApp = settings.save;
  return {
    list,
    pending: projectId ? saveProject.isPending : saveApp.isPending,
    save: (next: SavedPrompt[]) => {
      if (projectId) saveProject.mutate(next);
      else saveApp.mutate({ agentSettings: { ...settings.agentSettings, prompts: next } }, { onSuccess: () => toast.success('저장한 지시를 저장했습니다.') });
    },
  };
}
