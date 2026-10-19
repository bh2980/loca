import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_EDITOR_AI, type EditorAi } from '@tw/shared';
import { ModelPicker } from '@/components/model-picker';
import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Switch, SettingsSection } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { useFormFrom } from '@/lib/use-form-from';

/**
 * The editor's AI: the model for 'AI 번역·다듬기' (any connection, a CLI too:
 * the translator waits for it), the continuation (자동완성: on or off, an API model only, a CLI takes
 * seconds, too slow to follow typing), and how many calls a day both make at most, with today's count.
 */
export function EditorAiSection({ projectId }: { projectId: string }) {
  const project = useQuery(q.project(projectId));
  const queryClient = useQueryClient();
  const settings: EditorAi = project.data?.editorAi ?? DEFAULT_EDITOR_AI;
  // Follows the saved cap (changed elsewhere) until it is being typed.
  const { draft: cap, setDraft: setCap } = useFormFrom(String(settings.dailyCap), `editor-ai-cap.${projectId}`);
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
    <SettingsSection title="편집기 AI">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel>번역 모델</FieldLabel>
          <ModelPicker value={settings.assistModel} onChange={(assistModel) => change({ assistModel })} />
          <FieldDescription>편집기의 AI 번역·다듬기 버튼이 씁니다. CLI 연결도 됩니다.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Switch id="editor-ai-on" checked={settings.enabled} onCheckedChange={(enabled) => change({ enabled })} />
          <FieldLabel htmlFor="editor-ai-on">자동완성</FieldLabel>
        </Field>
        {/* Indented under the switch: the model and the daily cap belong to autocomplete only. */}
        <FieldGroup className="gap-4 border-l border-border-subtle pl-4">
          <Field>
            <FieldLabel>자동완성 모델</FieldLabel>
            <ModelPicker value={settings.model} onChange={(model) => change({ model })} kinds={['openai']} />
            <FieldDescription>입력하는 동안 바로 답해야 해서 API 연결만 고를 수 있습니다. CLI 연결은 응답이 느립니다.</FieldDescription>
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
            <FieldDescription>자동완성 호출만 셉니다. 오늘 {project.data?.editorCallsToday ?? 0}회 사용</FieldDescription>
          </Field>
        </FieldGroup>
        <div role={save.isError ? 'alert' : 'status'} aria-live={save.isError ? 'assertive' : 'polite'} className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
          {save.isPending && <><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> 저장 중</>}
          {save.isSuccess && <><Check aria-hidden="true" className="size-3.5 text-success" /> 저장했습니다</>}
          {save.isError && <><AlertCircle aria-hidden="true" className="size-3.5 text-destructive" /> 저장하지 못했습니다 {save.variables && <Button variant="ghost" onClick={() => save.mutate(save.variables)}>다시 시도</Button>}</>}
        </div>
      </FieldGroup>
    </SettingsSection>
  );
}
