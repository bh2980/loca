/** AI node settings, grouped by the user's task: model, instruction, output, advanced. */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { AI_OUTPUTS, AI_PRESETS, AI_SCOPES, CHOICE_SOURCES, CONNECTION_KIND_INFO, BATCH_MODE_LABELS, contextConfigSchema, nodeName, previousSteps, SUBJECT_BATCH_MODES, type WorkflowSubject, type AiOutput, type AiScope, type BatchConfig, type Capability, type ChoiceSource, type WorkflowNode } from '@tw/shared';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, InspectorActionRow, InspectorResult, InspectorSection } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { JsonFieldsEditor } from '@/components/workflow/node-config/json-fields-editor';
import { Field, CountRow, ToggleRow, refsSubject, outputFieldNames, type AiNode, type NodeRefs } from '@/components/workflow/node-config/shared';

/** The fields a preset fills into a node (a full AI node config minus the model). */
type PresetFill = Partial<Pick<AiNode['config'], 'instructions' | 'output' | 'scope' | 'fields' | 'choice'>>;

/** Custom choice values, one per line; the text is kept locally so a trailing newline can be typed. */
function ChoiceValues({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join('\n'));
  useEffect(() => {
    setText((current) => (current.split('\n').map((item) => item.trim()).filter(Boolean).join('\n') === values.join('\n') ? current : values.join('\n')));
  }, [values]);
  return (
    <Textarea
      aria-label="선택지"
      value={text}
      placeholder={'한 줄에 하나씩\n예: Casual'}
      className="min-h-20 text-sm"
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean));
      }}
    />
  );
}

/** The saved node's whole prompt (the read-only format part included) for a sample line. */
function PromptPreview({ projectId, workflowId, nodeId }: { projectId: string; workflowId?: string; nodeId: string }) {
  const [aiNode, setAiNode] = useState(workflowId ? `${workflowId}:${nodeId}` : undefined);
  const sample = useQuery({
    queryKey: ['units', 'prompt-sample', projectId],
    queryFn: () => unwrap(client.projects[':projectId'].lines.find.$post({ param: { projectId }, json: { offset: 0, limit: 1 } })),
  });
  const key = sample.data?.rows[0]?.key;
  if (!workflowId) return <p className="text-xs text-muted-foreground">저장된 워크플로에서 볼 수 있습니다.</p>;
  if (sample.isSuccess && !key) return <p className="text-xs text-muted-foreground">샘플로 쓸 대사가 없습니다.</p>;
  if (!key) return <p className="text-xs text-muted-foreground">샘플 대사를 불러오는 중…</p>;
  return <AiContextPanel projectId={projectId} unitKey={key} aiNode={aiNode} onAiNode={setAiNode} />;
}

export function AiConfig({ part, node, refs, onChange }: { part: 'model' | 'rest'; node: AiNode; refs: NodeRefs; onChange: (node: WorkflowNode) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const config = node.config;
  const subject = refsSubject(refs);
  // Saved workflows may predate a context setting; show its default.
  const context = contextConfigSchema.parse(config.context ?? {});
  const set = (patch: Partial<AiNode['config']>) => onChange({ ...node, config: { ...config, ...patch } });
  const need: Capability[] = config.output === 'verdict' ? ['generate', 'judge'] : ['generate'];
  const extras = config.extraModels;
  const chosenModels = new Set([config.model, ...extras].filter((choice) => choice.model).map((choice) => choice.model));
  const setExtra = (index: number, value: ModelValue) => set({ extraModels: extras.map((choice, i) => (i === index ? value : choice)) });
  const connection = refs.connections.find((item) => item.id === config.model.connectionId);
  const takesTemperature = connection ? CONNECTION_KIND_INFO[connection.kind].transport !== 'cli' && connection.kind !== 'systemone' : false;
  const contextOn = [context.glossary, context.speech, config.include.issues, context.precedingLines > 0, context.previousScenes > 0, context.cast, context.characters, context.relationships, context.documents].filter(Boolean).length;
  const preset = config.preset ? (AI_PRESETS as Record<string, { label: string } & PresetFill>)[config.preset] : undefined;

  if (part === 'model') {
    return (
      <>
      <Field label="모델">
        {/* More than one model splits the work between them. */}
        <div className="space-y-1.5">
          <ModelPicker need={need} value={config.model} onChange={(model) => set({ model })} />
          {extras.map((extra, index) => (
            <div key={index} className="flex min-w-0 items-center gap-1.5">
              <ModelPicker need={need} value={extra} onChange={(value) => setExtra(index, value)} className="min-w-0" />
              <Button size="icon" variant="ghost" className="shrink-0" aria-label="모델 빼기" onClick={() => set({ extraModels: extras.filter((_, i) => i !== index) })}>
                <X />
              </Button>
            </div>
          ))}
          {config.output === 'text' && chosenModels.size > 1 && <InspectorResult tone="info">서로 다른 모델이 번역을 나누면 장면마다 문체가 달라질 수 있습니다.</InspectorResult>}
          <Button variant="ghost" className="-ml-2 text-muted-foreground" disabled={!config.model.model || extras.some((choice) => !choice.model)} onClick={() => set({ extraModels: [...extras, { connectionId: '', model: '' }] })}>
            <Plus /> 모델
          </Button>
        </div>
      </Field>
      <Field label="동시 처리 수" hint="요청을 한꺼번에 몇 개까지 보낼지. CLI 연결이면 그만큼 모델 프로세스가 뜹니다. 실행마다 따로 셉니다.">
        <Input
          type="number"
          min={1}
          max={16}
          className="w-28"
          value={config.concurrency}
          onChange={(event) => set({ concurrency: Math.min(16, Math.max(1, Math.round(Number(event.target.value) || 1))) })}
        />
      </Field>
      </>
    );
  }

  return (
    <>
      <InspectorSection title="지시문" actions={
        <>
          <Button type="button" variant="ghost" size="inline" onClick={() => setExpanded(true)}>크게 열기</Button>
          <AiButton variant="ghost" prompt={`이 AI 노드의 지시문을 ${config.instructions.trim() ? '다듬어줘' : '작성해줘'}.`}>
            {config.instructions.trim() ? 'AI로 다듬기' : 'AI로 작성'}
          </AiButton>
        </>
      }>
        <Textarea aria-label="지시문" value={config.instructions} onChange={(event) => set({ instructions: event.target.value })} className="min-h-28 text-sm" />
        <InspectorActionRow
          label="프롬프트"
          description={config.preset ? (preset ? `프리셋 · ${preset.label}` : `프리셋 · ${config.preset}`) : '프리셋 없음'}
          action={
            <>
              {preset && <Button type="button" variant="ghost" onClick={() => setRefilling(true)}>다시 채우기</Button>}
              <Button type="button" variant="ghost" onClick={() => setPreviewing(true)}>미리보기</Button>
            </>
          }
        />
        <AlertDialog open={refilling} onOpenChange={setRefilling}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>프리셋으로 다시 채울까요?</AlertDialogTitle>
              <AlertDialogDescription>지시문·출력 형태·필드·선택지가 ‘{preset?.label}’ 프리셋의 값으로 바뀝니다. 지금 쓴 내용은 사라집니다.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => preset && set({ instructions: preset.instructions, output: preset.output, scope: preset.scope, fields: preset.fields, choice: preset.choice } as Partial<AiNode['config']>)}>다시 채우기</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog open={previewing} onOpenChange={setPreviewing}>
          <DialogContent className="flex h-[80vh] max-w-3xl flex-col">
            <DialogHeader><DialogTitle>프롬프트 · {nodeName(node)}</DialogTitle></DialogHeader>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto">
              <PromptPreview projectId={refs.projectId} workflowId={refs.workflowId} nodeId={node.id} />
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="flex h-[75vh] max-w-3xl flex-col">
            <DialogHeader><DialogTitle>지시문 · {nodeName(node)}</DialogTitle></DialogHeader>
            <Textarea autoFocus aria-label="지시문 크게 편집" value={config.instructions} onChange={(event) => set({ instructions: event.target.value })} className="min-h-0 flex-1 resize-none font-mono text-sm" />
          </DialogContent>
        </Dialog>
      </InspectorSection>

      <AiInputSection node={node} refs={refs} set={set} />

      <InspectorSection title="출력">
        <Field label="출력 형태">
          <Select value={config.output} onValueChange={(value) => set({ output: value as AiOutput, ...(value !== 'json' && { scope: 'line' as AiScope }) })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(AI_OUTPUTS) as AiOutput[]).map((output) => <SelectItem key={output} value={output}>{AI_OUTPUTS[output].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {config.output === 'json' && (
          <>
            <Field label="출력 단위">
              <Select value={config.scope} onValueChange={(value) => set({ scope: value as AiScope })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(AI_SCOPES) as AiScope[]).map((scope) => <SelectItem key={scope} value={scope}>{AI_SCOPES[scope]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <JsonFieldsEditor label="출력 필드" fields={config.fields} descriptionPlaceholder="AI에게 주는 설명" onChange={(fields) => set({ fields })} />
          </>
        )}
        {config.output === 'choice' && (
          <>
            <Field label="선택지 출처">
              <Select value={config.choice.source} onValueChange={(value) => set({ choice: { ...config.choice, source: value as ChoiceSource } })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(CHOICE_SOURCES) as ChoiceSource[]).map((source) => <SelectItem key={source} value={source}>{CHOICE_SOURCES[source]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {config.choice.source === 'custom' && (
              <Field label="선택지">
                <ChoiceValues values={config.choice.values} onChange={(values) => set({ choice: { ...config.choice, values } })} />
              </Field>
            )}
            <ToggleRow label="‘해당 없음’ 허용" checked={config.choice.allowNone} onChange={(value) => set({ choice: { ...config.choice, allowNone: value } })} />
          </>
        )}
      </InspectorSection>

      <InspectorSection title={`문맥 · ${contextOn}개 켬`} defaultOpen={false}>
        <AiContextFields config={config} set={set} subject={subject} />
      </InspectorSection>

      <InspectorSection title="고급" defaultOpen={false}>
        <>
          {takesTemperature && (
            <Field label="온도">
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                className="w-28"
                value={config.temperature ?? ''}
                placeholder="기본값"
                onChange={(event) =>
                  set({
                    temperature:
                      event.target.value === ''
                        ? undefined
                        : Math.min(2, Math.max(0, Number(event.target.value))),
                  })
                }
              />
            </Field>
          )}
          {config.output === 'text' && (
            <Field label="기존 번역">
              <Select
                value={config.include.candidate ? 'revise' : 'fresh'}
                onValueChange={(value) =>
                  set({ include: { ...config.include, candidate: value === 'revise' } })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fresh">보지 않고 새로 번역</SelectItem>
                  <SelectItem value="revise">보고 고침</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <>
            <Field label="묶음">
              <Select
                value={config.batch.mode}
                onValueChange={(value) =>
                  set({
                    batch: {
                      ...config.batch,
                      mode: value as BatchConfig['mode'],
                      // A new way of packing starts on auto: the whole script and scenes need very different budgets.
                      maxTokens: null,
                    },
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_BATCH_MODES[subject].map((mode) => <SelectItem key={mode} value={mode}>{subject === 'terms' && mode === 'unit' ? '용어 하나씩' : mode === 'unit' ? '대사 하나씩' : BATCH_MODE_LABELS[mode]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {config.batch.mode === 'count' && (
              <Field label={subject === 'terms' ? '요청당 용어 수' : '요청당 줄 수'}>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={config.batch.size}
                  onChange={(event) =>
                    set({ batch: { ...config.batch, size: Number(event.target.value) } })
                  }
                />
              </Field>
            )}
          </>
          <Field label="호출 제한 시간 (분)" hint="요청 하나가 이 시간을 넘으면 그 대사들은 오류(시간 초과) 출구로 나갑니다.">
            <Input
              type="number"
              min={1}
              max={240}
              className="w-28"
              value={config.timeoutMinutes}
              onChange={(event) => set({ timeoutMinutes: Math.min(240, Math.max(1, Math.round(Number(event.target.value) || 1))) })}
            />
          </Field>
        </>
      </InspectorSection>
    </>
  );
}

/** What an AI node (or an editor button, which is one) sends besides the lines: the context switches. */
export function AiContextFields({ config, set, subject = 'lines' }: { config: Pick<AiNode['config'], 'context' | 'include'>; set: (patch: Partial<AiNode['config']>) => void; subject?: WorkflowSubject }) {
  const context = contextConfigSchema.parse(config.context ?? {});
  const terms = subject === 'terms';
  const setContext = (patch: Partial<typeof context>) => set({ context: { ...context, ...patch } });
  return (
    <>
      <ToggleRow label="확정된 것만" checked={context.humanOnly} onChange={(value) => setContext({ humanOnly: value })} />
      <div className="space-y-2.5 border-t border-border-subtle pt-3">
        {terms ? (
          <CountRow label="용례" unit="줄" value={context.examples} fallback={2} max={5} onChange={(value) => setContext({ examples: value })} />
        ) : (
          <>
            <CountRow label="앞 대사" unit="줄" value={context.precedingLines} fallback={8} max={50} onChange={(value) => setContext({ precedingLines: value })} />
            {context.precedingLines > 0 && (
              <div className="pl-4">
                <ToggleRow label="앞 대사 번역" checked={context.precedingTranslations} onChange={(value) => setContext({ precedingTranslations: value })} />
              </div>
            )}
            <CountRow label="이전 장면" unit="개" value={context.previousScenes} fallback={1} max={10} onChange={(value) => setContext({ previousScenes: value })} />
            <ToggleRow label="앞 단계 지적" checked={config.include.issues} onChange={(value) => set({ include: { ...config.include, issues: value } })} />
          </>
        )}
      </div>
      <div className="space-y-2.5 border-t border-border-subtle pt-3">
        <ToggleRow label="용어집" checked={context.glossary} onChange={(value) => setContext({ glossary: value })} />
        {!terms && <ToggleRow label="청자·말투" checked={context.speech} onChange={(value) => setContext({ speech: value })} />}
        <ToggleRow label="인물 명단" checked={context.cast} onChange={(value) => setContext({ cast: value })} />
        <ToggleRow label="인물 프로필" checked={context.characters} onChange={(value) => setContext({ characters: value })} />
        <ToggleRow label="인물 관계" checked={context.relationships} onChange={(value) => setContext({ relationships: value })} />
        <ToggleRow label="문서" checked={context.documents} onChange={(value) => setContext({ documents: value })} />
      </div>
    </>
  );
}


/**
 * 입력: the previous step's result for each line, as the line's "previous" (the last node before it on the
 * line's way that leaves a result; conditions, checks and save nodes pass it on), or that alone without the lines.
 */
function AiInputSection({ node, refs, set }: { node: AiNode; refs: NodeRefs; set: (patch: Partial<AiNode['config']>) => void }) {
  const input = node.config.input;
  const steps = previousSteps({ nodes: refs.nodes, edges: refs.edges ?? [] }, node.id);
  const names = [...new Set(steps.flatMap(outputFieldNames))];
  const gathered = steps.some((step) => step.type === 'gather');
  const batch = node.config.output === 'json' && node.config.scope === 'batch';
  const setInput = (patch: Partial<AiNode['config']['input']>) => set({ input: { ...input, ...patch } });
  const from = steps.length ? `← ${steps.map(nodeName).join(', ')}` : '앞 단계에 결과를 내는 노드가 없습니다';
  return (
    <InspectorSection title={input.previous ? `입력 · 앞 단계 결과` : '입력'} defaultOpen={input.previous}>
      <Field label="앞 단계 결과" hint="선으로 이어진 앞 단계(AI·스크립트·모으기)의 결과를 대사마다 previous로 넣습니다. 조건·검사·저장 노드는 건너뜁니다.">
        <ToggleRow label={`넣기 · ${from}`} checked={input.previous} onChange={(previous) => setInput({ previous, fields: [], ...(previous ? (gathered && batch ? { lines: false } : {}) : { lines: true }) })} />
      </Field>
      {input.previous && names.length > 0 && (
        <Field label="남길 필드" hint="하나도 고르지 않으면 결과 전체를 넣습니다.">
          <div className="space-y-2">
            {names.map((name) => (
              <ToggleRow key={name} label={name} checked={input.fields.includes(name)} onChange={(on) => setInput({ fields: on ? [...input.fields, name] : input.fields.filter((field) => field !== name) })} />
            ))}
          </div>
        </Field>
      )}
      {input.previous && (batch || gathered) && <ToggleRow label="대사도 넣기" checked={input.lines} onChange={(lines) => setInput({ lines })} />}
    </InspectorSection>
  );
}
