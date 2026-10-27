import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { agentSettingsSchema, DEFAULT_EDITOR_AI, type AgentSettings, type EditorAi, type SavedPrompt } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';
import type { SettingsTarget } from '@/lib/settings-target';

export type SettingsPatch = { editorAi?: EditorAi; agentSettings?: AgentSettings; aiAutoConfirm?: boolean };

/**
 * Reads and saves the settings a project and the home's defaults share (editorAi, agentSettings,
 * aiAutoConfirm). A project reads `q.project` and patches the project; the home reads `q.appDefaults`
 * and patches `/app/defaults`. The change shows at once and is put back on failure.
 */
export function useTargetSettings(target: SettingsTarget) {
  const queryClient = useQueryClient();
  const projectId = target.kind === 'project' ? target.projectId : undefined;
  const project = useQuery({ ...q.project(projectId ?? ''), enabled: !!projectId });
  const app = useQuery({ ...q.appDefaults(), enabled: !projectId });
  const data = projectId ? project.data : app.data;
  const key = projectId ? q.project(projectId).queryKey : q.appDefaults().queryKey;

  const save = useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      if (projectId) await unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: patch as never }));
      else await unwrap(client.app.defaults.$patch({ json: patch as never }));
    },
    onMutate: async (patch) => ({ undo: await optimistic(queryClient, [{ key, update: (old: object) => ({ ...old, ...patch }) }]) }),
    onError: (error, _patch, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });

  return {
    loaded: !!data,
    editorAi: (data?.editorAi ?? DEFAULT_EDITOR_AI) as EditorAi,
    agentSettings: agentSettingsSchema.parse(data?.agentSettings ?? {}),
    aiAutoConfirm: data?.aiAutoConfirm ?? true,
    /** Project only: the editor's autocomplete calls made today. */
    editorCallsToday: project.data?.editorCallsToday,
    save,
  };
}

/** The saved instructions of a target: a project keeps them behind their own endpoint, the home inside its chat settings. */
export function useTargetPrompts(target: SettingsTarget) {
  const queryClient = useQueryClient();
  const projectId = target.kind === 'project' ? target.projectId : undefined;
  const settings = useTargetSettings(target);
  const projectPrompts = useQuery({ ...q.prompts(projectId ?? ''), enabled: !!projectId });
  const list: SavedPrompt[] = projectId ? (projectPrompts.data ?? []) : settings.agentSettings.prompts;

  const saveProject = useMutation({
    mutationFn: (next: SavedPrompt[]) => unwrap(client.projects[':projectId'].prompts.$put({ param: { projectId: projectId! }, json: { prompts: next } })),
    onMutate: (next) => {
      queryClient.setQueryData(q.prompts(projectId!).queryKey, next);
    },
    onSuccess: () => toast.success('저장한 지시를 저장했습니다.'),
    onError: (error) => toast.error(error.message),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: q.prompts(projectId!).queryKey }),
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
