import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DEFAULT_EDITOR_AI, type EditorAi } from '@tw/shared';
import { ModelPicker } from '@/components/model-picker';
import { SettingsSection } from '@/components/settings/section';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';
import { keyLabel } from '@/lib/keys';
import { q } from '@/lib/queries';

/**
 * The editor's AI continuation (docs/DESIGN.md J3b A): on or off, which API model, how many calls a
 * day at most, and how many were made today. CLI and pi connections are not offered: a call takes
 * seconds there, too slow to follow typing.
 */
export function EditorAiSection({ projectId }: { projectId: string }) {
  const project = useQuery(q.project(projectId));
  const settings: EditorAi = project.data?.editorAi ?? DEFAULT_EDITOR_AI;
  const [cap, setCap] = useState(String(settings.dailyCap));
  const save = useMutation({
    mutationFn: (editorAi: EditorAi) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { editorAi } })),
    onError: (error) => toast.error(error.message),
  });
  const change = (patch: Partial<EditorAi>) => save.mutate({ ...settings, ...patch });

  return (
    <SettingsSection
      title="편집기 자동완성"
      description={`번역 편집기에서 AI가 이어질 번역을 흐린 글씨로 보이고 Tab으로 받습니다. 줄을 빈 칸으로 열 때 한 번, ${keyLabel('Alt+/')}로 다시 부를 때만 요청합니다. 받고 저장한 번역은 사람이 정한 번역입니다.`}
    >
      <FieldGroup className="gap-4">
        <Field orientation="horizontal">
          <Switch id="editor-ai-on" checked={settings.enabled} onCheckedChange={(enabled) => change({ enabled })} />
          <FieldLabel htmlFor="editor-ai-on">켜기</FieldLabel>
        </Field>
        <Field>
          <FieldLabel>모델</FieldLabel>
          <ModelPicker value={settings.model} onChange={(model) => change({ model })} kinds={['openai']} />
          <FieldDescription>API 연결(OpenAI 호환)만 고를 수 있습니다. CLI 연결은 한 번에 수 초가 걸려 타자를 따라오지 못합니다. 요청마다 모델이 바뀌는 자동 선택(openrouter/free, auto)보다 모델을 하나 고정하세요.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="editor-ai-cap">하루 최대 호출</FieldLabel>
          <Input
            id="editor-ai-cap"
            type="number"
            min={1}
            className="w-32"
            value={cap}
            onChange={(event) => setCap(event.target.value)}
            onBlur={() => {
              const value = Math.max(1, Math.round(Number(cap) || settings.dailyCap));
              setCap(String(value));
              if (value !== settings.dailyCap) change({ dailyCap: value });
            }}
          />
          <FieldDescription>오늘 {project.data?.editorCallsToday ?? 0}회 사용. 다 쓰면 자동완성은 자정까지 조용히 멈춥니다.</FieldDescription>
        </Field>
      </FieldGroup>
    </SettingsSection>
  );
}
