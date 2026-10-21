/** AI node settings, grouped by the user's task: model, instruction, output, advanced. */
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { AI_OUTPUTS, AI_SCOPES, CONTEXT_FIELDS, CHOICE_SOURCES, CONNECTION_KIND_INFO, BATCH_MODE_LABELS, autoBudgets, contextConfigSchema, INPUT_TYPES, limitsFor, nodeName, previousSteps, type WorkflowSubject, type AiOutput, type AiScope, type BatchConfig, type Capability, type ChoiceSource, type WorkflowNode } from '@tw/shared';
import { Button, HelpTip, Dialog, DialogContent, DialogHeader, DialogTitle, Input, NumberInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, InspectorResult, InspectorSection } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { JsonFieldsEditor } from '@/components/workflow/node-config/json-fields-editor';
import { numberOrNull } from '@/lib/form-values';
import { useAutoLines } from '@/components/workflow/node-config/request-preview';
import { Field, CheckItem, CountRow, StepChips, ToggleRow, outputFieldNames, refsInput, type AiNode, type NodeRefs } from '@/components/workflow/node-config/shared';


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


export function AiConfig({ part, node, refs, onChange }: { part: 'model' | 'rest'; node: AiNode; refs: NodeRefs; onChange: (node: WorkflowNode) => void }) {
  const [expanded, setExpanded] = useState(false);
  const config = node.config;
  const input = refsInput(refs);
  // Saved workflows may predate a context setting; show its default.
  const context = contextConfigSchema.parse(config.context ?? {});
  const set = (patch: Partial<AiNode['config']>) => onChange({ ...node, config: { ...config, ...patch } });
  const need: Capability[] = config.output === 'verdict' ? ['generate', 'judge'] : ['generate'];
  const extras = config.extraModels;
  const chosenModels = new Set([config.model, ...extras].filter((choice) => choice.model).map((choice) => choice.model));
  const setExtra = (index: number, value: ModelValue) => set({ extraModels: extras.map((choice, i) => (i === index ? value : choice)) });
  const connection = refs.connections.find((item) => item.id === config.model.connectionId);
  // What auto would pick for this node's own model, shown while the field is empty.
  // From the server for a saved workflow (it also reads this node's past requests); the model's limits alone while it is not saved.
  const learned = useAutoLines(refs.workflowId, node.id, config.model, config.output, config.batch.mode);
  const autoLines = learned.data?.lines ?? autoBudgets(limitsFor(connection && { inputTokens: connection.inputTokens ?? null, outputTokens: connection.outputTokens ?? null, modelLimits: connection.modelLimits ?? {} }, config.model.model), config.output, config.batch.mode).lines;
  const takesTemperature = connection ? CONNECTION_KIND_INFO[connection.kind].transport !== 'cli' && connection.kind !== 'systemone' : false;
  const contextOn = [config.include.candidate, context.glossary, context.speech, context.precedingLines > 0, context.previousScenes > 0, context.cast, context.characters, context.relationships, context.documents].filter(Boolean).length;

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
      <Field label="동시 처리 수" help="AI에 동시에 보내는 요청 수입니다. 늘리면 빨라지지만, API는 요청 한도에 걸리기 쉽고 CLI 연결은 그 수만큼 프로그램이 떠서 컴퓨터가 무거워집니다.">
        <NumberInput min={1} max={16} className="w-28" value={config.concurrency} onValueChange={(concurrency) => concurrency !== undefined && set({ concurrency })} />
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
                <SelectContent>{(Object.keys(AI_SCOPES) as AiScope[]).map((scope) => <SelectItem key={scope} value={scope}>{scope === 'line' ? `${INPUT_TYPES[input].label}마다` : AI_SCOPES[scope]}</SelectItem>)}</SelectContent>
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
        <AiContextFields config={config} set={set} input={input} />
      </InspectorSection>

      <InspectorSection title="고급" defaultOpen={false}>
        <>
          {takesTemperature && (
            <Field label="온도">
              <NumberInput min={0} max={2} step={0.1} integer={false} optional className="w-28" value={config.temperature} placeholder="기본값" onValueChange={(temperature) => set({ temperature })} />
            </Field>
          )}
          <>
            <Field label={<span className="flex items-center gap-1">요청 단위<HelpTip>AI 요청 한 번에 항목을 어떻게 묶어 보낼지 정합니다.</HelpTip></span>}>
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
                  {INPUT_TYPES[input].batchModes.map((mode) => <SelectItem key={mode} value={mode}>{mode === 'unit' ? `${INPUT_TYPES[input].label} 하나씩` : BATCH_MODE_LABELS[mode]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {(config.batch.mode === 'group' || config.batch.mode === 'whole') && (
              <Field
                label="요청당 대사 양"
                hint={config.batch.maxTokens === null ? '자동' : '직접 입력'}
                help="AI 요청 한 번에 담는 대사의 양입니다. 보통은 비워 두고, 더 잘게 나누고 싶을 때만 적습니다."
              >
                <Input
                  type="number"
                  min={500}
                  max={10_000_000}
                  className="w-40"
                  value={config.batch.maxTokens ?? ''}
                  placeholder={autoLines.toLocaleString()}
                  onChange={(event) => set({ batch: { ...config.batch, maxTokens: numberOrNull(event.target.value) } })}
                />
              </Field>
            )}
            {config.batch.mode === 'count' && (
              <Field label={`요청당 ${INPUT_TYPES[input].label} 수`}>
                <NumberInput min={1} max={1000} value={config.batch.size} onValueChange={(size) => size !== undefined && set({ batch: { ...config.batch, size } })} />
              </Field>
            )}
          </>
          <Field label="호출 제한 시간 (분)" help="요청 하나가 이 시간을 넘기면 그 요청의 항목들은 오류(시간 초과) 출구로 나갑니다.">
            <NumberInput min={1} max={240} className="w-28" value={config.timeoutMinutes} onValueChange={(timeoutMinutes) => timeoutMinutes !== undefined && set({ timeoutMinutes })} />
          </Field>
        </>
      </InspectorSection>
    </>
  );
}

/** What an AI node sends besides the items: the core context switches and those of the workflow's input (INPUT_TYPES). */
export function AiContextFields({ config, set, input }: { config: Pick<AiNode['config'], 'context' | 'include'>; set: (patch: Partial<AiNode['config']>) => void; input: WorkflowSubject }) {
  const context = contextConfigSchema.parse(config.context ?? {});
  const lines = input === 'lines';
  const setContext = (patch: Partial<typeof context>) => set({ context: { ...context, ...patch } });
  return (
    <>
      <div className="space-y-2.5">
        {lines ? <>
            <CountRow label={CONTEXT_FIELDS.precedingLines.label} help={CONTEXT_FIELDS.precedingLines.help} unit="줄" value={context.precedingLines} fallback={8} max={50} onChange={(value) => setContext({ precedingLines: value })} />
            {context.precedingLines > 0 && (
              <div className="pl-4">
                <ToggleRow label={CONTEXT_FIELDS.precedingTranslations.label} help={CONTEXT_FIELDS.precedingTranslations.help} checked={context.precedingTranslations} onChange={(value) => setContext({ precedingTranslations: value })} />
              </div>
            )}
            <CountRow label={CONTEXT_FIELDS.previousScenes.label} help={CONTEXT_FIELDS.previousScenes.help} unit="개" value={context.previousScenes} fallback={1} max={10} onChange={(value) => setContext({ previousScenes: value })} />
        </> : (
            <CountRow label={CONTEXT_FIELDS.examples.label} help={CONTEXT_FIELDS.examples.help} unit="줄" value={context.examples} fallback={2} max={5} onChange={(value) => setContext({ examples: value })} />
        )}
      </div>
      <div className="space-y-2.5 border-t border-border-subtle pt-3">
        <ToggleRow label={CONTEXT_FIELDS.candidate.label} help={CONTEXT_FIELDS.candidate.help} checked={config.include.candidate} onChange={(value) => set({ include: { ...config.include, candidate: value } })} />
        <ToggleRow label={CONTEXT_FIELDS.glossary.label} help={CONTEXT_FIELDS.glossary.help} checked={context.glossary} onChange={(value) => setContext({ glossary: value })} />
        {lines && <ToggleRow label={CONTEXT_FIELDS.speech.label} help={CONTEXT_FIELDS.speech.help} checked={context.speech} onChange={(value) => setContext({ speech: value })} />}
        <ToggleRow label={CONTEXT_FIELDS.cast.label} help={CONTEXT_FIELDS.cast.help} checked={context.cast} onChange={(value) => setContext({ cast: value })} />
        <ToggleRow label={CONTEXT_FIELDS.characters.label} help={CONTEXT_FIELDS.characters.help} checked={context.characters} onChange={(value) => setContext({ characters: value })} />
        <ToggleRow label={CONTEXT_FIELDS.relationships.label} help={CONTEXT_FIELDS.relationships.help} checked={context.relationships} onChange={(value) => setContext({ relationships: value })} />
        <ToggleRow label={CONTEXT_FIELDS.documents.label} help={CONTEXT_FIELDS.documents.help} checked={context.documents} onChange={(value) => setContext({ documents: value })} />
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
  const id = (name: string) => `ai-input-${node.id}-${name}`;
  return (
    // Open whenever a step before it returns something, so what it can take in is in sight.
    <InspectorSection title="입력" defaultOpen={input.previous || steps.length > 0}>
      <div className="space-y-3">
        <CheckItem
          id={id('previous')}
          label="앞 단계 결과도 함께 보내기"
          title="선으로 이어진 바로 앞에서 결과를 내는 노드(AI·검사·스크립트·HTTP·모으기)의 결과를 대사마다 보냅니다. 조건·저장 노드는 건너뜁니다."
          checked={input.previous}
          onChange={(previous) => setInput({ previous, fields: [], ...(previous ? (gathered && batch ? { lines: false } : {}) : { lines: true }) })}
        />
        {input.previous && (
          <div className="space-y-3 pl-6">
            <StepChips steps={steps} refs={refs} suffix="의 결과" />
            {names.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">보낼 항목</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {names.map((name) => (
                    <CheckItem key={name} id={id(`field-${name}`)} label={name} checked={input.fields.includes(name)} onChange={(on) => setInput({ fields: on ? [...input.fields, name] : input.fields.filter((field) => field !== name) })} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">아무것도 고르지 않으면 전부 보냅니다.</p>
              </div>
            )}
            {(batch || gathered) && <CheckItem id={id('lines')} label="대사도 함께 보내기" checked={input.lines} onChange={(lines) => setInput({ lines })} />}
          </div>
        )}
      </div>
    </InspectorSection>
  );
}
