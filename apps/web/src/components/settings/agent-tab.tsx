import { toast } from 'sonner';
import { AGENT_ACTIONS, AGENT_RESOURCES, effectiveAgentPermissions, PERMISSION_MODE_INFO, type AgentAction, type AgentPermissions, type AgentResource, type AgentSettings, type PermissionMode } from '@tw/shared';
import { PermissionModePicker } from '@/components/chat/permission-mode';
import { Box, Button, PermissionMatrix, Text, Section, Inline } from '@loca/ui';
import { ModelPicker } from '@/components/model-picker';
import type { SettingsTarget } from '@/lib/settings-target';
import { useTargetSettings } from '@/lib/target-settings';
import { SavedPromptsSection } from './saved-prompts';

const RESOURCES = Object.keys(AGENT_RESOURCES) as AgentResource[];
const ACTIONS = Object.keys(AGENT_ACTIONS) as AgentAction[];
const MATRIX_ACTIONS = ACTIONS.map((id) => ({ id, label: AGENT_ACTIONS[id] }));
const MATRIX_ROWS = RESOURCES.map((id) => {
  const resource = AGENT_RESOURCES[id];
  // Only a consequence a person would not expect is spelled out (running a workflow can write to the project).
  return { id, label: resource.label, supported: resource.actions as readonly AgentAction[], ...('description' in resource && { description: resource.description }) };
});

export function AgentTab({ target }: { target: SettingsTarget }) {
  const { loaded, agentSettings: settings, save: saveAgent } = useTargetSettings(target);
  const save = {
    ...saveAgent,
    mutate: (next: AgentSettings) => saveAgent.mutate({ agentSettings: next }, { onSuccess: () => toast.success('채팅 설정을 저장했습니다.') }),
  };
  const permissions = effectiveAgentPermissions(settings);
  const defaultMode: PermissionMode = settings.defaultPermissionMode;

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
      <Text as="p" role="status" aria-live="polite" srOnly>{save.isPending ? '채팅 설정 저장 중' : save.isSuccess ? '채팅 설정 저장됨' : ''}</Text>
      <Box spaceY="wide">
        <Section variant="page" title="새 대화 모델" description="새 대화가 처음 쓰는 모델. 비워 두면 마지막 대화의 모델을 씁니다.">
          <Inline gap="condensed" maxWidth="reading">
            <Box minWidth={0} grow>
              <ModelPicker
                target={target}
                need={['chat']}
                value={settings.chatModel ?? { connectionId: '', model: '' }}
                onChange={(next) => next.connectionId && next.model && saveSettings({ ...settings, chatModel: next })}
              />
            </Box>
            {settings.chatModel && (
              <Button variant="ghost" disabled={!loaded || save.isPending} onClick={() => saveSettings({ ...settings, chatModel: null })}>
                지우기
              </Button>
            )}
          </Inline>
        </Section>

        <Section variant="page" title="권한 모드" description="새 대화가 시작하는 모드. 대화마다 바꿀 수 있습니다.">
          <Box spaceY="condensed">
            <PermissionModePicker width="medium" value={defaultMode} disabled={!loaded || save.isPending} onChange={(mode) => saveSettings({ ...settings, defaultPermissionMode: mode })} />
            <Text as="p" variant="caption" tone="muted">{PERMISSION_MODE_INFO[defaultMode].description}</Text>
          </Box>
        </Section>

        <SavedPromptsSection target={target} />

        <Section variant="page" title="도구 권한" description="채팅 AI와 터미널의 loca call에만 적용됩니다. 삭제는 기본으로 꺼져 있습니다.">
          <PermissionMatrix
            actions={MATRIX_ACTIONS}
            rows={MATRIX_ROWS}
            checked={(resource, action) => permissions[resource]?.[action] === true}
            disabled={!loaded || save.isPending}
            onChange={setPermission}
          />
        </Section>
      </Box>
    </div>
  );
}
