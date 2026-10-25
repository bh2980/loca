/** The workflow's own settings: shown in the editor's right-hand pane while no node is selected. */
import { Box, Inspector, InspectorHeader, NumberInput, Section, Field } from '@loca/ui';
import type { WorkflowDefinition } from '@tw/shared';
import {  } from '@/components/workflow/node-config/shared';

type Settings = WorkflowDefinition['settings'];

export function WorkflowSettings({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  return (
    <Inspector bare flush header={<InspectorHeader name="워크플로 설정" />}>
      <Section title="실행">
        <Field label="연속 실패" description="요청이 이만큼 연달아 실패하면 실행을 멈춥니다." help="재요청 노드가 다시 보내는 실패는 세지 않습니다. 1~50번.">
          <Box asChild width="field"><NumberInput min={1} max={50} value={settings.maxConsecutiveFailures} onValueChange={(maxConsecutiveFailures) => maxConsecutiveFailures !== undefined && set({ maxConsecutiveFailures })} /></Box>
        </Field>
        <Field label="노드 방문 상한" description="한 대사가 같은 노드를 지날 수 있는 최대 횟수입니다." help="되돌아가는 연결이 끝없이 돌지 않게 막습니다. 재요청 최대 횟수보다 커야 합니다. 1~50번.">
          <Box asChild width="field"><NumberInput min={1} max={50} value={settings.maxVisitsPerNode} onValueChange={(maxVisitsPerNode) => maxVisitsPerNode !== undefined && set({ maxVisitsPerNode })} /></Box>
        </Field>
      </Section>
    </Inspector>
  );
}
