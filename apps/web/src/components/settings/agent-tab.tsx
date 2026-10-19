import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AGENT_ACTIONS, AGENT_RESOURCES, agentSettingsSchema, effectiveAgentPermissions, PERMISSION_MODE_INFO, type AgentAction, type AgentPermissions, type AgentResource, type AgentSettings, type PermissionMode } from '@tw/shared';
import { PermissionModePicker } from '@/components/chat/permission-mode';
import { Button, Input, InspectorField, PermissionMatrix, SettingsSection } from '@loca/ui';
import { ModelPicker } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { q } from '@/lib/queries';
import { useFormFrom } from '@/lib/use-form-from';

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
  const { bypassLimits } = settings;
  const { draft: changesDraft, setDraft: setChangesDraft } = useFormFrom(String(bypassLimits.changes), `agent-bypass-changes.${projectId}`);
  const { draft: costDraft, setDraft: setCostDraft } = useFormFrom(bypassLimits.costUsd === null ? '' : String(bypassLimits.costUsd), `agent-bypass-cost.${projectId}`);
  const changes = Number(changesDraft);
  const costUsd = costDraft.trim() === '' ? null : Number(costDraft);
  const changesValid = Number.isInteger(changes) && changes >= 1 && changes <= 10_000;
  const costValid = costUsd === null || (Number.isFinite(costUsd) && costUsd >= 0);
  const limitsDirty = changesDraft !== String(bypassLimits.changes) || costDraft !== (bypassLimits.costUsd === null ? '' : String(bypassLimits.costUsd));

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
          <div className="space-y-4">
            <div className="space-y-1.5">
              <PermissionModePicker className="w-48" value={defaultMode} disabled={!loaded || save.isPending} onChange={(mode) => saveSettings({ ...settings, defaultPermissionMode: mode })} />
              <p className="text-xs text-muted-foreground">{PERMISSION_MODE_INFO[defaultMode].description}</p>
            </div>
            {/* The brake on 바로 반영: under the mode it belongs to, so what it limits is plain. */}
            <div className="max-w-md space-y-3 rounded-md border border-border-subtle p-3">
              <div>
                <p className="text-sm font-medium text-foreground">바로 반영 한도</p>
                <p className="text-xs text-muted-foreground">‘바로 반영’ 대화에서 이만큼 바꾸거나 비용이 들면, 그다음 변경부터 다시 묻습니다. 대화마다 따로 셉니다.</p>
              </div>
              <InspectorField label="변경 수" error={!changesValid ? '1부터 10,000까지의 정수' : undefined}>
                <Input type="number" min={1} max={10_000} step={1} value={changesDraft} disabled={!loaded || save.isPending} onChange={(event) => setChangesDraft(event.target.value)} aria-invalid={!changesValid} />
              </InspectorField>
              <InspectorField label="비용 (USD)" description="비우면 비용으로는 묻지 않습니다." error={!costValid ? '0 이상이거나 비워 두세요' : undefined}>
                <Input type="number" min={0} step="any" placeholder="제한 없음" value={costDraft} disabled={!loaded || save.isPending} onChange={(event) => setCostDraft(event.target.value)} aria-invalid={!costValid} />
              </InspectorField>
              {limitsDirty && (
                <Button disabled={!loaded || save.isPending || !changesValid || !costValid} onClick={() => saveSettings({ ...settings, bypassLimits: { changes, costUsd } })}>
                  한도 저장
                </Button>
              )}
            </div>
          </div>
        </SettingsSection>

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
