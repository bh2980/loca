import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { AI_PROMPTS, COMPLETE_SYSTEM, CONTEXT_FIELDS, DEFAULT_EDITOR_AI, type EditorAi, type EditorButton } from '@tw/shared';
import { ModelPicker } from '@/components/model-picker';
import { Box, Button, Checkbox, Collapsible, CollapsibleContent, CollapsibleTrigger, Field, HelpTip, Icon, Inline, SaveStatusLine, Stack, Switch, Text, Textarea, Input, Section } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { useFormFrom } from '@/lib/use-form-from';

/** A text kept locally while typed and saved when the field is left (a prompt is long; one save, not one per key). */
function SavedText({ id, label, value, storage, rows = 6, onSave }: { id: string; label: string; value: string; storage: string; rows?: number; onSave: (value: string) => void }) {
  const { draft, setDraft } = useFormFrom(value, storage);
  return <Textarea mono id={id} aria-label={label} rows={rows} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== value && onSave(draft)} />;
}

/** A whole number kept locally while typed, saved within its bounds when the field is left. */
function SavedNumber({ id, label, value, min, max, storage, disabled, width, onSave }: { id: string; label?: string; value: number; min: number; max: number; storage: string; disabled?: boolean; width?: 'field' | 'count'; onSave: (value: number) => void }) {
  const { draft, setDraft } = useFormFrom(String(value), storage);
  return (
    <Input
      id={id}
      aria-label={label}
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      width={width === 'count' ? 'field-3xs' : 'field-md'}
      align={width === 'count' ? 'right' : undefined}
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
function ContextCheck({ id, label, help, checked, onChange, count }: { id: string; label: string; help?: string; checked: boolean; onChange: (on: boolean) => void; count?: { value: number; max: number; unit: string; storage: string; onSave: (value: number) => void } }) {
  return (
    <Inline as="span" gap="snug" variant="body">
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onChange(on === true)} />
      <label htmlFor={id}>{label}</label>
      {help && <HelpTip>{help}</HelpTip>}
      {count && checked && (
        <Inline as="span" gap="tight" variant="caption" tone="muted">
          <SavedNumber id={`${id}-count`} label={`${label} 수`} value={count.value} min={1} max={count.max} storage={count.storage} width="count" onSave={count.onSave} />
          {count.unit}
        </Inline>
      )}
    </Inline>
  );
}

/** Instructions as one line (프리셋 사용 중 · 편집); the text opens below it. */
function Instructions({ id, label, value, preset, presetLabel, storage, onSave }: { id: string; label: string; value: string; preset: string; presetLabel: string; storage: string; onSave: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const own = value !== preset;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Inline gap="condensed" minWidth={0} variant="body">
        <Text width="field-2xs" shrink={false}>{label}</Text>
        <Text minWidth={0} grow truncate tone="muted">{own ? `${presetLabel}에서 바꿈` : `${presetLabel} 사용 중`}</Text>
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
      </Inline>
      <CollapsibleContent paddingTop="condensed">
        <SavedText id={id} label={`${label} 지시문`} value={value} storage={storage} onSave={onSave} />
        <Field.Description attached>출력 형식 안내는 서버가 덧붙입니다.</Field.Description>
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
    <Section variant="page" title="편집기 AI">
      <Field.Group gap="wide">
        <Field.Group>
          <Box>
            <Text as="p" variant="label">AI 번역 · 다듬기</Text>
            <Text as="p" variant="caption" tone="muted">편집기의 두 버튼. 대사 하나를 번역하거나 번역가의 초안을 다듬어 AI 후보로 넣습니다. CLI 연결도 됩니다.</Text>
          </Box>
          <Field>
            <Field.Label>모델</Field.Label>
            <ModelPicker value={settings.model} onChange={(model) => change({ model })} />
          </Field>
          <Field>
            <Field.Label>함께 보낼 것</Field.Label>
            <Stack direction="row" wrap gapX="comfortable" gapY="condensed">
              <ContextCheck id="editor-ai-glossary" label={CONTEXT_FIELDS.glossary.label} help={CONTEXT_FIELDS.glossary.help} checked={context.glossary} onChange={(glossary) => setContext({ glossary })} />
              <ContextCheck id="editor-ai-speech" label={CONTEXT_FIELDS.speech.label} help={CONTEXT_FIELDS.speech.help} checked={context.speech} onChange={(speech) => setContext({ speech })} />
              <ContextCheck id="editor-ai-preceding" label={CONTEXT_FIELDS.precedingLines.label} help={CONTEXT_FIELDS.precedingLines.help} checked={context.precedingLines > 0} onChange={(on) => setContext({ precedingLines: on ? 8 : 0 })} count={{ value: context.precedingLines, max: 50, unit: '줄', storage: key('preceding'), onSave: (precedingLines) => setContext({ precedingLines }) }} />
              {context.precedingLines > 0 && <ContextCheck id="editor-ai-preceding-translations" label={CONTEXT_FIELDS.precedingTranslations.label} help={CONTEXT_FIELDS.precedingTranslations.help} checked={context.precedingTranslations} onChange={(precedingTranslations) => setContext({ precedingTranslations })} />}
              <ContextCheck id="editor-ai-scenes" label={CONTEXT_FIELDS.previousScenes.label} help={CONTEXT_FIELDS.previousScenes.help} checked={context.previousScenes > 0} onChange={(on) => setContext({ previousScenes: on ? 1 : 0 })} count={{ value: context.previousScenes, max: 10, unit: '개', storage: key('scenes'), onSave: (previousScenes) => setContext({ previousScenes }) }} />
              <ContextCheck id="editor-ai-cast" label={CONTEXT_FIELDS.cast.label} help={CONTEXT_FIELDS.cast.help} checked={context.cast} onChange={(cast) => setContext({ cast })} />
              <ContextCheck id="editor-ai-characters" label={CONTEXT_FIELDS.characters.label} help={CONTEXT_FIELDS.characters.help} checked={context.characters} onChange={(characters) => setContext({ characters })} />
              <ContextCheck id="editor-ai-relationships" label={CONTEXT_FIELDS.relationships.label} help={CONTEXT_FIELDS.relationships.help} checked={context.relationships} onChange={(relationships) => setContext({ relationships })} />
              <ContextCheck id="editor-ai-documents" label={CONTEXT_FIELDS.documents.label} help={CONTEXT_FIELDS.documents.help} checked={context.documents} onChange={(documents) => setContext({ documents })} />
            </Stack>
          </Field>
          <Field>
            <Field.Label>지시문</Field.Label>
            <Box spaceY="tight">
              {(['translate', 'refine'] as const).map((id) => (
                <Instructions
                  key={id}
                  id={`editor-ai-${id}-instructions`}
                  label={id === 'translate' ? 'AI 번역' : '다듬기'}
                  value={settings[id].instructions}
                  preset={AI_PROMPTS[id].instructions}
                  presetLabel="기본 지시문"
                  storage={key(`${id}-instructions`)}
                  onSave={(instructions) => setButton(id, { instructions })}
                />
              ))}
            </Box>
          </Field>
        </Field.Group>

        <Field.Group>
          <Field orientation="horizontal">
            <Switch id="editor-ai-on" checked={complete.enabled} onCheckedChange={(enabled) => setComplete({ enabled })} />
            <Field.Label htmlFor="editor-ai-on">자동완성</Field.Label>
            <Text variant="caption" tone="muted" tabular marginLeft="auto">
              오늘 {project.data?.editorCallsToday ?? 0}/{complete.dailyCap}회
            </Text>
          </Field>
          {/* Indented under the switch: everything here belongs to autocomplete only. */}
          <Field.Group nested>
            <Field>
              <Field.Label>모델</Field.Label>
              <ModelPicker value={complete.model} onChange={(model) => setComplete({ model })} kinds={['openai']} />
              <Field.Description>API 연결만 됩니다.</Field.Description>
            </Field>
            <Field>
              <Field.Label>함께 보낼 것</Field.Label>
              <Stack direction="row" wrap gapX="comfortable" gapY="condensed">
                <ContextCheck id="editor-ai-complete-glossary" label={CONTEXT_FIELDS.glossary.label} help={CONTEXT_FIELDS.glossary.help} checked={complete.glossary} onChange={(glossary) => setComplete({ glossary })} />
                <ContextCheck id="editor-ai-complete-speech" label={CONTEXT_FIELDS.speech.label} help={CONTEXT_FIELDS.speech.help} checked={complete.speech} onChange={(speech) => setComplete({ speech })} />
                <ContextCheck id="editor-ai-complete-preceding" label="앞 대사(번역 포함)" help="번역 중인 대사 바로 앞의 대사를 원문과 지금 번역으로 함께 보냅니다." checked={complete.precedingLines > 0} onChange={(on) => setComplete({ precedingLines: on ? 3 : 0 })} count={{ value: complete.precedingLines, max: 20, unit: '줄', storage: key('complete-preceding'), onSave: (precedingLines) => setComplete({ precedingLines }) }} />
              </Stack>
            </Field>
            <Field>
              <Field.Label>지시문</Field.Label>
              <Instructions id="editor-ai-complete-instructions" label="자동완성" value={complete.instructions} preset={COMPLETE_SYSTEM} presetLabel="기본" storage={key('complete-instructions')} onSave={(instructions) => setComplete({ instructions })} />
            </Field>
          </Field.Group>
        </Field.Group>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" group flush="start">
              <Icon icon={ChevronRight} turn="group" /> 고급
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Field.Group lead>
              <Field>
                <Field.Label htmlFor="editor-ai-timeout">에디터 AI 제한 시간 (초)</Field.Label>
                <SavedNumber id="editor-ai-timeout" value={settings.timeoutSeconds} min={10} max={600} storage={key('timeout')} onSave={(timeoutSeconds) => change({ timeoutSeconds })} />
                <Field.Description>AI 번역·다듬기와 서식 규칙의 자연어로 정규식 만들기가 답을 기다리는 시간입니다.</Field.Description>
              </Field>
              <Field>
                <Field.Label htmlFor="editor-ai-complete-timeout">자동완성 제한 시간 (초)</Field.Label>
                <SavedNumber id="editor-ai-complete-timeout" value={complete.timeoutSeconds} min={3} max={120} storage={key('complete-timeout')} onSave={(timeoutSeconds) => setComplete({ timeoutSeconds })} />
                <Field.Description>이보다 늦은 답은 입력에 도움이 되지 않아 버립니다.</Field.Description>
              </Field>
              <Field>
                <Field.Label htmlFor="editor-ai-complete-delay">자동완성 대기 시간 (밀리초)</Field.Label>
                <SavedNumber id="editor-ai-complete-delay" value={complete.delayMs} min={0} max={5000} storage={key('complete-delay')} onSave={(delayMs) => setComplete({ delayMs })} />
                <Field.Description>대사를 열고 이만큼 머물러야 자동완성을 요청합니다. ↑↓로 지나가는 대사에는 요청하지 않습니다.</Field.Description>
              </Field>
              <Field>
                <Field.Label htmlFor="editor-ai-cap">자동완성 하루 최대 호출</Field.Label>
                <SavedNumber id="editor-ai-cap" value={complete.dailyCap} min={1} max={100_000} storage={key('cap')} onSave={(dailyCap) => setComplete({ dailyCap })} />
              </Field>
            </Field.Group>
          </CollapsibleContent>
        </Collapsible>

        <SaveStatusLine
          status={save.isPending ? 'saving' : save.isSuccess ? 'saved' : save.isError ? 'failed' : 'idle'}
          onRetry={save.variables ? () => save.mutate(save.variables) : undefined}
        />
      </Field.Group>
    </Section>
  );
}
