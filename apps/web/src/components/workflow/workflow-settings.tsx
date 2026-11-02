/** The workflow's own settings: shown in the editor's right-hand pane while no node is selected. */
import { Box, Inspector, InspectorHeader, NumberInput, Section, Field, Text } from '@loca/ui';
import type { WorkflowDefinition } from '@tw/shared';
import { RetryRules } from '@/components/workflow/node-config/retry';

type Settings = WorkflowDefinition['settings'];

export function WorkflowSettings({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  return (
    <Inspector bare flush header={<InspectorHeader name="워크플로 설정" />}>
      <Section title="실행">
        <Field label="연속 실패" description="요청이 이만큼 연달아 실패하면 실행을 멈춥니다." help="재시도 규칙이 다시 보내는 실패는 세지 않습니다. 1~50번.">
          <Box asChild width="field"><NumberInput min={1} max={50} value={settings.maxConsecutiveFailures} onValueChange={(maxConsecutiveFailures) => maxConsecutiveFailures !== undefined && set({ maxConsecutiveFailures })} /></Box>
        </Field>
        <Field label="노드 방문 상한" description="한 대사가 같은 노드를 지날 수 있는 최대 횟수입니다." help="되돌아가는 연결이 끝없이 돌지 않게 막습니다. 재시도로 다시 보낸 횟수는 세지 않습니다. 1~50번.">
          <Box asChild width="field"><NumberInput min={1} max={50} value={settings.maxVisitsPerNode} onValueChange={(maxVisitsPerNode) => maxVisitsPerNode !== undefined && set({ maxVisitsPerNode })} /></Box>
        </Field>
      </Section>
      <Section title="재시도 규칙" collapsible persistKey="workflow.retries">
        <Box spaceY="condensed">
          <Text as="p" variant="caption" tone="muted">요청이 실패한 대사를 AI 노드에 다시 보내는 규칙입니다. 규칙을 따로 정하지 않은 AI 노드는 모두 이 규칙을 따릅니다. 위에서부터 그 오류를 받고 횟수가 남은 첫 규칙이 보내고, 받을 규칙이 없으면 '오류' 출구로 나갑니다.</Text>
          <RetryRules id="workflow-retry" rules={settings.retries} onChange={(retries) => set({ retries })} />
        </Box>
      </Section>
    </Inspector>
  );
}
