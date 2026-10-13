import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
 * The editor's AI (docs/DESIGN.md J3b): the model for 'AI 번역·다듬기' (any connection, a CLI too:
 * the translator waits for it), the continuation (자동완성: on or off, an API model only, a CLI takes
 * seconds, too slow to follow typing), and how many calls a day both make at most, with today's count.
 */
export function EditorAiSection({ projectId }: { projectId: string }) {
  const project = useQuery(q.project(projectId));
  const queryClient = useQueryClient();
  const settings: EditorAi = project.data?.editorAi ?? DEFAULT_EDITOR_AI;
  const [cap, setCap] = useState(String(settings.dailyCap));
  // Shown at once: the project's cached settings change before the server answers (undone on failure).
  const save = useMutation({
    mutationFn: (editorAi: EditorAi) => unwrap(client.projects[':projectId'].$patch({ param: { projectId }, json: { editorAi } })),
    onMutate: async (editorAi) => {
      const key = q.project(projectId).queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old) => (old ? { ...old, editorAi } : old));
      return { before };
    },
    onError: (error, _value, context) => {
      if (context?.before) queryClient.setQueryData(q.project(projectId).queryKey, context.before);
      toast.error(error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: q.project(projectId).queryKey }),
  });
  const change = (patch: Partial<EditorAi>) => save.mutate({ ...settings, ...patch });

  return (
    <SettingsSection
      title="편집기 AI"
      description="번역 편집기의 AI 번역·다듬기와 자동완성. 받고 저장한 번역은 사람이 정한 번역입니다."
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel>AI 번역·다듬기 모델</FieldLabel>
          <ModelPicker value={settings.assistModel} onChange={(assistModel) => change({ assistModel })} />
          <FieldDescription>편집기의 [AI 번역]·[다듬기]가 씁니다. CLI 연결도 됩니다. 실행과 같은 문맥(말투 규칙·용어·앞 대사·문체)을 보내고, 결과는 그 줄의 AI 후보가 됩니다.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Switch id="editor-ai-on" checked={settings.enabled} onCheckedChange={(enabled) => change({ enabled })} />
          <FieldLabel htmlFor="editor-ai-on">자동완성 켜기</FieldLabel>
        </Field>
        <FieldDescription>AI가 이어질 번역을 흐린 글씨로 보이고 Tab으로 받습니다. 줄을 빈 칸으로 열 때 한 번, {keyLabel('Alt+/')}로 다시 부를 때만 요청합니다.</FieldDescription>
        <Field>
          <FieldLabel>자동완성 모델</FieldLabel>
          <ModelPicker value={settings.model} onChange={(model) => change({ model })} kinds={['openai']} />
          <FieldDescription>API 연결만 됩니다. 모델은 하나로 고정하세요.</FieldDescription>
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
          <FieldDescription>자동완성과 AI 번역·다듬기를 합쳐 오늘 {project.data?.editorCallsToday ?? 0}회 사용. 다 쓰면 자동완성은 자정까지 조용히 멈추고, AI 번역·다듬기는 한도 알림을 보입니다.</FieldDescription>
        </Field>
      </FieldGroup>
    </SettingsSection>
  );
}
