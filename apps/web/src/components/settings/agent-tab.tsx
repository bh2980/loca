import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AGENT_ACTIONS, AGENT_RESOURCES, agentSettingsSchema, effectiveAgentPermissions, PERMISSION_MODE_INFO, type AgentAction, type AgentPermissions, type AgentResource, type AgentSettings, type PermissionMode } from '@tw/shared';
import { PermissionModePicker } from '@/components/chat/permission-mode';
import { Button, PermissionMatrix, SettingsSection } from '@loca/ui';
import { ModelPicker } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';
import { SavedPromptsSection } from './saved-prompts';

const RESOURCES = Object.keys(AGENT_RESOURCES) as AgentResource[];
const ACTIONS = Object.keys(AGENT_ACTIONS) as AgentAction[];
const MATRIX_ACTIONS = ACTIONS.map((id) => ({ id, label: AGENT_ACTIONS[id] }));
const MATRIX_ROWS = RESOURCES.map((id) => {
  const resource = AGENT_RESOURCES[id];
  // Only a consequence a person would not expect is spelled out (running a workflow can write to the project).
  return { id, label: resource.label, supported: resource.actions as readonly AgentAction[], ...('description' in resource && { description: resource.description }) };
});

export function AgentTab({ projectId: propProjectId }: { projectId?: string } = {}) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = propProjectId ?? params.projectId!;
  const queryClient = useQueryClient();
  const project = useQuery(q.project(projectId));
  const loaded = !!project.data;
  const settings = agentSettingsSchema.parse(project.data?.agentSettings ?? {});
  const permissions = effectiveAgentPermissions(settings);
  const defaultMode: PermissionMode = settings.defaultPermissionMode;

  const save = useMutation({
    mutationFn: (next: AgentSettings) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { agentSettings: next } })),
    onMutate: async (next) => ({
      undo: await optimistic(queryClient, [{ key: ['units', 'project', projectId], update: (data: { agentSettings: object }) => ({ ...data, agentSettings: next }) }]),
    }),
    onSuccess: () => toast.success('채팅 설정을 저장했습니다.'),
    onError: (error, _next, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });

  const saveSettings = (next: AgentSettings, nextPermissions: AgentPermissions = effectiveAgentPermissions(settings)) => {
    save.mutate({ ...next, disabledTools: [], permissions: nextPermissions });
  };
  const setPermission = (resource: AgentResource, action: AgentAction, allowed: boolean) => {
    const nextPermissions: AgentPermissions = {
      ...permissions,
      [resource]: { ...permissions[resource], [action]: allowed },
    };
    saveSettings(settings, nextPermissions);
  };

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">{save.isPending ? '채팅 설정 저장 중' : save.isSuccess ? '채팅 설정 저장됨' : ''}</p>
      <div className="space-y-8">
        <SettingsSection title="새 대화 모델" description="새 대화가 처음 쓰는 모델. 비워 두면 마지막 대화의 모델을 씁니다.">
          <div className="flex max-w-md items-center gap-2">
            <div className="min-w-0 flex-1">
              <ModelPicker
                need={['chat']}
                value={settings.chatModel ?? { connectionId: '', model: '' }}
                onChange={(next) => next.connectionId && next.model && saveSettings({ ...settings, chatModel: next })}
              />
            </div>
            {settings.chatModel && (
              <Button variant="ghost" disabled={!loaded || save.isPending} onClick={() => saveSettings({ ...settings, chatModel: null })}>
                지우기
              </Button>
            )}
          </div>
        </SettingsSection>

        <SettingsSection title="권한 모드" description="새 대화가 시작하는 모드. 대화마다 바꿀 수 있습니다.">
          <div className="space-y-1.5">
            <PermissionModePicker className="w-48" value={defaultMode} disabled={!loaded || save.isPending} onChange={(mode) => saveSettings({ ...settings, defaultPermissionMode: mode })} />
            <p className="text-xs text-muted-foreground">{PERMISSION_MODE_INFO[defaultMode].description}</p>
          </div>
        </SettingsSection>

        <SavedPromptsSection projectId={projectId} />

        <SettingsSection title="도구 권한" description="채팅 AI와 터미널의 loca call에만 적용됩니다. 삭제는 기본으로 꺼져 있습니다.">
          <PermissionMatrix
            actions={MATRIX_ACTIONS}
            rows={MATRIX_ROWS}
            checked={(resource, action) => permissions[resource]?.[action] === true}
            disabled={!loaded || save.isPending}
            onChange={setPermission}
          />
        </SettingsSection>
      </div>
    </div>
  );
}
