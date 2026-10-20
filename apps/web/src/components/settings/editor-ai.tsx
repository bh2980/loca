import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, ChevronRight, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { AI_PRESETS, COMPLETE_SYSTEM, DEFAULT_EDITOR_AI, type EditorAi, type EditorButton } from '@tw/shared';
import { ModelPicker } from '@/components/model-picker';
import { Button, Checkbox, Collapsible, CollapsibleContent, CollapsibleTrigger, Field, FieldDescription, FieldGroup, FieldLabel, Input, Switch, SettingsSection, Textarea } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { useFormFrom } from '@/lib/use-form-from';

/** A text kept locally while typed and saved when the field is left (a prompt is long; one save, not one per key). */
function SavedText({ id, label, value, storage, rows = 6, onSave }: { id: string; label: string; value: string; storage: string; rows?: number; onSave: (value: string) => void }) {
  const { draft, setDraft } = useFormFrom(value, storage);
  return <Textarea id={id} aria-label={label} rows={rows} value={draft} className="font-mono text-xs" onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== value && onSave(draft)} />;
}

/** A whole number kept locally while typed, saved within its bounds when the field is left. */
function SavedNumber({ id, label, value, min, max, storage, disabled, className = 'w-32', onSave }: { id: string; label?: string; value: number; min: number; max: number; storage: string; disabled?: boolean; className?: string; onSave: (value: number) => void }) {
  const { draft, setDraft } = useFormFrom(String(value), storage);
  return (
    <Input
      id={id}
      aria-label={label}
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      className={className}
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

/** One thing sent with the line, as a checkbox; a count (앞 대사 n줄) sits beside it while it is on. */
function ContextCheck({ id, label, checked, onChange, count }: { id: string; label: string; checked: boolean; onChange: (on: boolean) => void; count?: { value: number; max: number; unit: string; storage: string; onSave: (value: number) => void } }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onChange(on === true)} />
      <label htmlFor={id}>{label}</label>
      {count && checked && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <SavedNumber id={`${id}-count`} label={`${label} 수`} value={count.value} min={1} max={count.max} storage={count.storage} className="h-7 w-14 text-right" onSave={count.onSave} />
          {count.unit}
        </span>
      )}
    </span>
  );
}

/** Instructions as one line (프리셋 사용 중 · 편집); the text opens below it. */
function Instructions({ id, label, value, preset, presetLabel, storage, onSave }: { id: string; label: string; value: string; preset: string; presetLabel: string; storage: string; onSave: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const own = value !== preset;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="w-16 shrink-0">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{own ? `${presetLabel}에서 바꿈` : `${presetLabel} 사용 중`}</span>
        {own && (
          <Button variant="ghost" onClick={() => onSave(preset)}>
            되돌리기
          </Button>
        )}
        <CollapsibleTrigger asChild>
          <Button variant="ghost" aria-expanded={open}>
            {open ? '닫기' : '편집'}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pt-2">
        <SavedText id={id} label={`${label} 지시문`} value={value} storage={storage} onSave={onSave} />
        <FieldDescription className="mt-1">출력 형식 안내는 서버가 덧붙입니다.</FieldDescription>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The editor's AI, per project. AI 번역 and 다듬기 share one model (any connection, a CLI too) and what
 * is sent with the line, each button with its own instructions (from the AI 번역 / AI 다듬기 presets);
 * the continuation (자동완성) answers as the person types, so it has its own API model. Time limits
 * and caps are under 고급. Materials are sent whether or not a person confirmed them (the context's default).
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
  const context = settings.context;
  const setContext = (patch: Partial<EditorAi['context']>) => change({ context: { ...context, ...patch } });
  const setButton = (id: EditorButton, patch: Partial<EditorAi[EditorButton]>) => change({ [id]: { ...settings[id], ...patch } });
  const complete = settings.complete;
  const setComplete = (patch: Partial<EditorAi['complete']>) => change({ complete: { ...complete, ...patch } });
  const key = (name: string) => `editor-ai-${name}.${projectId}`;

  return (
    <SettingsSection title="편집기 AI">
      <FieldGroup className="gap-8">
        <FieldGroup className="gap-4">
          <div>
            <p className="text-sm font-medium">AI 번역 · 다듬기</p>
            <p className="text-xs text-muted-foreground">편집기의 두 버튼. 대사 하나를 번역하거나 번역가의 초안을 다듬어 AI 후보로 넣습니다. CLI 연결도 됩니다.</p>
          </div>
          <Field>
            <FieldLabel>모델</FieldLabel>
            <ModelPicker value={settings.model} onChange={(model) => change({ model })} />
          </Field>
          <Field>
            <FieldLabel>함께 보낼 것</FieldLabel>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <ContextCheck id="editor-ai-glossary" label="용어집" checked={context.glossary} onChange={(glossary) => setContext({ glossary })} />
              <ContextCheck id="editor-ai-speech" label="청자·말투" checked={context.speech} onChange={(speech) => setContext({ speech })} />
              <ContextCheck id="editor-ai-preceding" label="앞 대사" checked={context.precedingLines > 0} onChange={(on) => setContext({ precedingLines: on ? 8 : 0 })} count={{ value: context.precedingLines, max: 50, unit: '줄', storage: key('preceding'), onSave: (precedingLines) => setContext({ precedingLines }) }} />
              {context.precedingLines > 0 && <ContextCheck id="editor-ai-preceding-translations" label="앞 대사의 번역" checked={context.precedingTranslations} onChange={(precedingTranslations) => setContext({ precedingTranslations })} />}
              <ContextCheck id="editor-ai-scenes" label="이전 장면" checked={context.previousScenes > 0} onChange={(on) => setContext({ previousScenes: on ? 1 : 0 })} count={{ value: context.previousScenes, max: 10, unit: '개', storage: key('scenes'), onSave: (previousScenes) => setContext({ previousScenes }) }} />
              <ContextCheck id="editor-ai-cast" label="인물 명단" checked={context.cast} onChange={(cast) => setContext({ cast })} />
              <ContextCheck id="editor-ai-characters" label="인물 프로필" checked={context.characters} onChange={(characters) => setContext({ characters })} />
              <ContextCheck id="editor-ai-relationships" label="인물 관계" checked={context.relationships} onChange={(relationships) => setContext({ relationships })} />
              <ContextCheck id="editor-ai-documents" label="문서" checked={context.documents} onChange={(documents) => setContext({ documents })} />
            </div>
          </Field>
          <Field>
            <FieldLabel>지시문</FieldLabel>
            <div className="space-y-1">
              {(['translate', 'refine'] as const).map((id) => (
                <Instructions
                  key={id}
                  id={`editor-ai-${id}-instructions`}
                  label={id === 'translate' ? 'AI 번역' : '다듬기'}
                  value={settings[id].instructions}
                  preset={AI_PRESETS[id].instructions}
                  presetLabel={`프리셋 ${AI_PRESETS[id].label}`}
                  storage={key(`${id}-instructions`)}
                  onSave={(instructions) => setButton(id, { instructions })}
                />
              ))}
            </div>
          </Field>
        </FieldGroup>

        <FieldGroup className="gap-4">
          <Field orientation="horizontal">
            <Switch id="editor-ai-on" checked={complete.enabled} onCheckedChange={(enabled) => setComplete({ enabled })} />
            <FieldLabel htmlFor="editor-ai-on">자동완성</FieldLabel>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              오늘 {project.data?.editorCallsToday ?? 0}/{complete.dailyCap}회
            </span>
          </Field>
          {/* Indented under the switch: everything here belongs to autocomplete only. */}
          <FieldGroup className="gap-4 border-l border-border-subtle pl-4">
            <Field>
              <FieldLabel>모델</FieldLabel>
              <ModelPicker value={complete.model} onChange={(model) => setComplete({ model })} kinds={['openai']} />
              <FieldDescription>API 연결만 됩니다.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>함께 보낼 것</FieldLabel>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <ContextCheck id="editor-ai-complete-glossary" label="용어집" checked={complete.glossary} onChange={(glossary) => setComplete({ glossary })} />
                <ContextCheck id="editor-ai-complete-speech" label="청자·말투" checked={complete.speech} onChange={(speech) => setComplete({ speech })} />
                <ContextCheck id="editor-ai-complete-preceding" label="앞 대사(번역 포함)" checked={complete.precedingLines > 0} onChange={(on) => setComplete({ precedingLines: on ? 3 : 0 })} count={{ value: complete.precedingLines, max: 20, unit: '줄', storage: key('complete-preceding'), onSave: (precedingLines) => setComplete({ precedingLines }) }} />
              </div>
            </Field>
            <Field>
              <FieldLabel>지시문</FieldLabel>
              <Instructions id="editor-ai-complete-instructions" label="자동완성" value={complete.instructions} preset={COMPLETE_SYSTEM} presetLabel="기본" storage={key('complete-instructions')} onSave={(instructions) => setComplete({ instructions })} />
            </Field>
          </FieldGroup>
        </FieldGroup>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="group -ml-2">
              <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" /> 고급
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FieldGroup className="gap-4 pt-3">
              <Field>
                <FieldLabel htmlFor="editor-ai-timeout">에디터 AI 제한 시간 (초)</FieldLabel>
                <SavedNumber id="editor-ai-timeout" value={settings.timeoutSeconds} min={10} max={600} storage={key('timeout')} onSave={(timeoutSeconds) => change({ timeoutSeconds })} />
                <FieldDescription>AI 번역·다듬기와 서식 규칙의 자연어로 정규식 만들기가 답을 기다리는 시간입니다.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="editor-ai-complete-timeout">자동완성 제한 시간 (초)</FieldLabel>
                <SavedNumber id="editor-ai-complete-timeout" value={complete.timeoutSeconds} min={3} max={120} storage={key('complete-timeout')} onSave={(timeoutSeconds) => setComplete({ timeoutSeconds })} />
                <FieldDescription>이보다 늦은 답은 입력에 도움이 되지 않아 버립니다.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="editor-ai-cap">자동완성 하루 최대 호출</FieldLabel>
                <SavedNumber id="editor-ai-cap" value={complete.dailyCap} min={1} max={100_000} storage={key('cap')} onSave={(dailyCap) => setComplete({ dailyCap })} />
              </Field>
            </FieldGroup>
          </CollapsibleContent>
        </Collapsible>

        <div role={save.isError ? 'alert' : 'status'} aria-live={save.isError ? 'assertive' : 'polite'} className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
          {save.isPending && <><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> 저장 중</>}
          {save.isSuccess && <><Check aria-hidden="true" className="size-3.5 text-success" /> 저장했습니다</>}
          {save.isError && <><AlertCircle aria-hidden="true" className="size-3.5 text-destructive" /> 저장하지 못했습니다 {save.variables && <Button variant="ghost" onClick={() => save.mutate(save.variables)}>다시 시도</Button>}</>}
        </div>
      </FieldGroup>
    </SettingsSection>
  );
}
