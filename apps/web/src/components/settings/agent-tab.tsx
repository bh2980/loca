import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AGENT_ACTIONS, AGENT_RESOURCES, agentSettingsSchema, effectiveAgentPermissions, type AgentAction, type AgentPermissions, type AgentResource, type AgentSettings, type PermissionMode } from '@tw/shared';
import { PermissionModePicker } from '@/components/chat/permission-mode';
import { AdvancedDisclosure, Button, Field, FieldLabel, Input, PermissionMatrix, SettingsSection, Switch } from '@loca/ui';
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
    onSuccess: () => toast.success('에이전트 설정을 저장했습니다.'),
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

  const limits = (
    <SettingsSection title="자동 반영 후 다시 확인" description="대화별 기준이며 전체 과금 상한은 아닙니다.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="bypass-changes">대화당 변경 수</FieldLabel>
          <Input id="bypass-changes" type="number" min={1} max={10_000} step={1} value={changesDraft} disabled={!loaded || save.isPending} onChange={(event) => setChangesDraft(event.target.value)} aria-invalid={!changesValid} />
          {!changesValid && <p role="alert" className="text-xs text-destructive">1부터 10,000까지의 정수를 입력하세요.</p>}
        </Field>
        <Field>
          <FieldLabel htmlFor="bypass-cost">대화당 보고 비용 (USD)</FieldLabel>
          <Input id="bypass-cost" type="number" min={0} step="any" placeholder="제한 없음" value={costDraft} disabled={!loaded || save.isPending} onChange={(event) => setCostDraft(event.target.value)} aria-invalid={!costValid} />
          {!costValid && <p role="alert" className="text-xs text-destructive">0 이상의 비용을 입력하거나 비워 두세요.</p>}
        </Field>
      </div>
      <Button disabled={!loaded || save.isPending || !limitsDirty || !changesValid || !costValid} onClick={() => saveSettings({ ...settings, bypassLimits: { changes, costUsd } })}>한도 저장</Button>
    </SettingsSection>
  );

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">{save.isPending ? '에이전트 설정 저장 중' : save.isSuccess ? '에이전트 설정 저장됨' : ''}</p>
      <div className="space-y-8">
        <SettingsSection title="새 대화의 권한 모드">
          <PermissionModePicker className="w-48" value={defaultMode} disabled={!loaded || save.isPending} onChange={(mode) => saveSettings({ ...settings, defaultPermissionMode: mode })} />
        </SettingsSection>

        <SettingsSection title="도구와 권한" description="채팅 AI와 터미널의 loca call에만 적용됩니다.">
          <PermissionMatrix
            actions={MATRIX_ACTIONS}
            rows={MATRIX_ROWS}
            checked={(resource, action) => permissions[resource]?.[action] === true}
            disabled={!loaded || save.isPending}
            onChange={setPermission}
          />
        </SettingsSection>

        {defaultMode === 'bypass' ? limits : <AdvancedDisclosure label="다른 대화에서 바로 반영 모드를 쓸 때의 한도">{limits}</AdvancedDisclosure>}
      </div>
    </div>
  );
}
