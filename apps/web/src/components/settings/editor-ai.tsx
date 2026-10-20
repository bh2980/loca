import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { AI_PRESETS, COMPLETE_SYSTEM, DEFAULT_EDITOR_AI, type EditorAi } from '@tw/shared';
import { ModelPicker } from '@/components/model-picker';
import { AiContextFields } from '@/components/workflow/node-config/ai';
import { CountRow, ToggleRow } from '@/components/workflow/node-config/shared';
import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Switch, SettingsSection, Textarea } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { useFormFrom } from '@/lib/use-form-from';

type ButtonId = 'translate' | 'refine';
const BUTTONS: Record<ButtonId, { title: string; description: string }> = {
  translate: { title: 'AI 번역', description: '편집기의 AI 번역 버튼. 대사 하나를 번역해 AI 후보로 넣습니다. CLI 연결도 됩니다.' },
  refine: { title: '다듬기', description: '편집기의 다듬기 버튼. 번역가의 초안을 필요한 곳만 고치고, 고친 이유를 후보 메모로 남깁니다.' },
};

/** A text kept locally while typed and saved when the field is left (a prompt is long; one save, not one per key). */
function SavedText({ id, label, value, storage, rows = 6, onSave }: { id: string; label: string; value: string; storage: string; rows?: number; onSave: (value: string) => void }) {
  const { draft, setDraft } = useFormFrom(value, storage);
  return <Textarea id={id} aria-label={label} rows={rows} value={draft} className="font-mono text-xs" onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== value && onSave(draft)} />;
}

/** A whole number kept locally while typed, saved within its bounds when the field is left. */
function SavedNumber({ id, value, min, max, storage, onSave }: { id: string; value: number; min: number; max: number; storage: string; onSave: (value: number) => void }) {
  const { draft, setDraft } = useFormFrom(String(value), storage);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      className="w-32"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = Math.min(max, Math.max(min, Math.round(Number(draft) || value)));
        setDraft(String(next));
        if (next !== value) onSave(next);
      }}
    />
  );
}

/**
 * The editor's AI, per project. Each button (AI 번역, 다듬기) is an AI node of its own: model,
 * instructions, context and call time limit, filled from the AI 번역 / AI 다듬기 presets until changed
 * (a workflow's nodes are separate). The continuation (자동완성: an API model only, it answers as the
 * person types) has its instructions, context, time limit and daily cap; 정규식 만들기 its time limit.
 */
export function EditorAiSection({ projectId }: { projectId: string }) {
  const project = useQuery(q.project(projectId));
  const queryClient = useQueryClient();
  const settings: EditorAi = project.data?.editorAi ?? DEFAULT_EDITOR_AI;
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
  const setButton = (id: ButtonId, patch: Partial<EditorAi[ButtonId]>) => change({ [id]: { ...settings[id], ...patch } });
  const complete = settings.complete;
  const setComplete = (patch: Partial<EditorAi['complete']>) => change({ complete: { ...complete, ...patch } });

  return (
    <SettingsSection title="편집기 AI">
      <FieldGroup className="gap-8">
        {(Object.keys(BUTTONS) as ButtonId[]).map((id) => {
          const button = settings[id];
          const preset = AI_PRESETS[id];
          const isPreset = button.instructions === preset.instructions;
          return (
            <FieldGroup key={id} className="gap-4">
              <div>
                <p className="text-sm font-medium">{BUTTONS[id].title}</p>
                <p className="text-xs text-muted-foreground">{BUTTONS[id].description}</p>
              </div>
              <Field>
                <FieldLabel>모델</FieldLabel>
                <ModelPicker value={button.model} onChange={(model) => setButton(id, { model })} />
              </Field>
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor={`editor-ai-${id}-instructions`}>지시문</FieldLabel>
                  <Button
                    variant="ghost"
                   
                    disabled={isPreset}
                    onClick={() => setButton(id, { instructions: preset.instructions, include: preset.include, context: { ...DEFAULT_EDITOR_AI[id].context } })}
                  >
                    프리셋으로 되돌리기
                  </Button>
                </div>
                <SavedText id={`editor-ai-${id}-instructions`} label={`${BUTTONS[id].title} 지시문`} value={button.instructions} storage={`editor-ai-${id}-instructions.${projectId}`} onSave={(instructions) => setButton(id, { instructions })} />
                <FieldDescription>{isPreset ? `프리셋 · ${preset.label}` : `프리셋 · ${preset.label}에서 바꿈`}. 출력 형식 안내는 서버가 덧붙입니다.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>문맥</FieldLabel>
                <div className="space-y-2.5 rounded-md border border-border-subtle p-3">
                  <AiContextFields config={button} set={(patch) => setButton(id, patch)} />
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor={`editor-ai-${id}-timeout`}>호출 제한 시간 (분)</FieldLabel>
                <SavedNumber id={`editor-ai-${id}-timeout`} value={button.timeoutMinutes} min={1} max={240} storage={`editor-ai-${id}-timeout.${projectId}`} onSave={(timeoutMinutes) => setButton(id, { timeoutMinutes })} />
              </Field>
            </FieldGroup>
          );
        })}

        <FieldGroup className="gap-4">
          <Field orientation="horizontal">
            <Switch id="editor-ai-on" checked={complete.enabled} onCheckedChange={(enabled) => setComplete({ enabled })} />
            <FieldLabel htmlFor="editor-ai-on">자동완성</FieldLabel>
          </Field>
          {/* Indented under the switch: everything here belongs to autocomplete only. */}
          <FieldGroup className="gap-4 border-l border-border-subtle pl-4">
            <Field>
              <FieldLabel>모델</FieldLabel>
              <ModelPicker value={complete.model} onChange={(model) => setComplete({ model })} kinds={['openai']} />
              <FieldDescription>입력하는 동안 바로 답해야 해서 API 연결만 고를 수 있습니다. CLI 연결은 응답이 느립니다.</FieldDescription>
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="editor-ai-complete-instructions">지시문</FieldLabel>
                <Button variant="ghost" disabled={complete.instructions === COMPLETE_SYSTEM} onClick={() => setComplete({ instructions: COMPLETE_SYSTEM })}>
                  기본으로 되돌리기
                </Button>
              </div>
              <SavedText id="editor-ai-complete-instructions" label="자동완성 지시문" rows={4} value={complete.instructions} storage={`editor-ai-complete-instructions.${projectId}`} onSave={(instructions) => setComplete({ instructions })} />
            </Field>
            <Field>
              <FieldLabel>문맥</FieldLabel>
              <div className="space-y-2.5 rounded-md border border-border-subtle p-3">
                <CountRow label="앞 대사 (번역 포함)" unit="줄" value={complete.precedingLines} fallback={3} max={20} onChange={(precedingLines) => setComplete({ precedingLines })} />
                <ToggleRow label="용어집" checked={complete.glossary} onChange={(glossary) => setComplete({ glossary })} />
                <ToggleRow label="청자·말투" checked={complete.speech} onChange={(speech) => setComplete({ speech })} />
              </div>
              <FieldDescription>대사와 서식 기호는 늘 들어갑니다.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="editor-ai-complete-timeout">제한 시간 (초)</FieldLabel>
              <SavedNumber id="editor-ai-complete-timeout" value={complete.timeoutSeconds} min={3} max={120} storage={`editor-ai-complete-timeout.${projectId}`} onSave={(timeoutSeconds) => setComplete({ timeoutSeconds })} />
              <FieldDescription>이보다 늦은 답은 입력에 도움이 되지 않아 버립니다.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="editor-ai-cap">하루 최대 호출</FieldLabel>
              <SavedNumber id="editor-ai-cap" value={complete.dailyCap} min={1} max={100_000} storage={`editor-ai-cap.${projectId}`} onSave={(dailyCap) => setComplete({ dailyCap })} />
              <FieldDescription>자동완성 호출만 셉니다. 오늘 {project.data?.editorCallsToday ?? 0}회 사용</FieldDescription>
            </Field>
          </FieldGroup>
        </FieldGroup>

        <Field>
          <FieldLabel htmlFor="editor-ai-regex-timeout">자연어로 정규식 만들기 · 제한 시간 (초)</FieldLabel>
          <SavedNumber id="editor-ai-regex-timeout" value={settings.regex.timeoutSeconds} min={10} max={600} storage={`editor-ai-regex-timeout.${projectId}`} onSave={(timeoutSeconds) => change({ regex: { timeoutSeconds } })} />
          <FieldDescription>형식 규칙의 AI로 정규식 만들기가 기본 모델을 부를 때 기다리는 시간입니다.</FieldDescription>
        </Field>

        <div role={save.isError ? 'alert' : 'status'} aria-live={save.isError ? 'assertive' : 'polite'} className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
          {save.isPending && <><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> 저장 중</>}
          {save.isSuccess && <><Check aria-hidden="true" className="size-3.5 text-success" /> 저장했습니다</>}
          {save.isError && <><AlertCircle aria-hidden="true" className="size-3.5 text-destructive" /> 저장하지 못했습니다 {save.variables && <Button variant="ghost" onClick={() => save.mutate(save.variables)}>다시 시도</Button>}</>}
        </div>
      </FieldGroup>
    </SettingsSection>
  );
}
