/** AI node settings, grouped by the user's task: model, instruction, output, advanced. */
import { useEffect, useState } from 'react';
import { AI_OUTPUTS, AI_SCOPES, CONTEXT_FIELDS, CHOICE_SOURCES, CONNECTION_KIND_INFO, BATCH_MODE_LABELS, autoBudgets, contextConfigSchema, INPUT_TYPES, limitsFor, nodeName, previousSteps, type WorkflowSubject, type AiOutput, type AiScope, type BatchConfig, type Capability, type ChoiceSource, type WorkflowNode } from '@tw/shared';
import { Box, Button, Dialog, DialogContent, DialogHeader, DialogTitle, HelpTip, Inline, Input, NumberInput, SelectField, SelectItem, Stack, Text, Textarea, Section, Field } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { ModelPicker } from '@/components/model-picker';
import { JsonFieldsEditor } from '@/components/workflow/node-config/json-fields-editor';
import { numberOrNull } from '@/lib/form-values';
import { CheckItem, CountRow, StepChips, ToggleRow, outputFieldNames, refsInput, type AiNode, type NodeRefs } from '@/components/workflow/node-config/shared';


/** Custom choice values, one per line; the text is kept locally so a trailing newline can be typed. */
function ChoiceValues({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join('\n'));
  useEffect(() => {
    setText((current) => (current.split('\n').map((item) => item.trim()).filter(Boolean).join('\n') === values.join('\n') ? current : values.join('\n')));
  }, [values]);
  return (
    <Box asChild minHeight="textarea-sm" variant="body">
      <Textarea
        aria-label="선택지"
        value={text}
        placeholder={'한 줄에 하나씩\n예: Casual'}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean));
        }}
      />
    </Box>
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
  const connection = refs.connections.find((item) => item.id === config.model.connectionId);
  // What auto would pick for this node's own model, shown while the field is empty.
  const autoLines = autoBudgets(limitsFor(connection && { modelLimits: connection.modelLimits ?? {} }, config.model.model), config.output, config.batch.mode).lines;
  const takesTemperature = connection ? CONNECTION_KIND_INFO[connection.kind].transport !== 'cli' && connection.kind !== 'systemone' : false;
  const contextOn = [config.include.candidate, context.glossary, context.speech, context.precedingLines > 0, context.previousScenes > 0, context.cast, context.characters, context.relationships, context.documents].filter(Boolean).length;

  if (part === 'model') {
    return (
      <>
      <Field label="모델">
        <ModelPicker need={need} value={config.model} onChange={(model) => set({ model })} />
      </Field>
      <Field label="동시 처리 수" help="AI에 동시에 보내는 요청 수입니다. 늘리면 빨라지지만, API는 요청 한도에 걸리기 쉽고 CLI 연결은 그 수만큼 프로그램이 떠서 컴퓨터가 무거워집니다.">
        <Box asChild width="field"><NumberInput min={1} max={16} value={config.concurrency} onValueChange={(concurrency) => concurrency !== undefined && set({ concurrency })} /></Box>
      </Field>
      </>
    );
  }

  return (
    <>
      <Section title="지시문" actions={
        <>
          <Button type="button" variant="ghost" size="inline" onClick={() => setExpanded(true)}>크게 열기</Button>
          <AiButton variant="ghost" prompt={`이 AI 노드의 지시문을 ${config.instructions.trim() ? '다듬어줘' : '작성해줘'}.`}>
            {config.instructions.trim() ? 'AI로 다듬기' : 'AI로 작성'}
          </AiButton>
        </>
      }>
        <Box asChild minHeight="textarea" variant="body"><Textarea aria-label="지시문" value={config.instructions} onChange={(event) => set({ instructions: event.target.value })} /></Box>
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent height="dialog">
            <DialogHeader><DialogTitle>{`지시문 · ${nodeName(node)}`}</DialogTitle></DialogHeader>
            <Box asChild minHeight={0} grow resize="none" mono variant="body"><Textarea autoFocus aria-label="지시문 크게 편집" value={config.instructions} onChange={(event) => set({ instructions: event.target.value })} /></Box>
          </DialogContent>
        </Dialog>
      </Section>

      <AiInputSection node={node} refs={refs} set={set} />

      <Section title="출력">
        <Field label="출력 형태">
          <SelectField value={config.output} onValueChange={(value) => set({ output: value as AiOutput, ...(value !== 'json' && { scope: 'line' as AiScope }) })}>
            {(Object.keys(AI_OUTPUTS) as AiOutput[]).map((output) => <SelectItem key={output} value={output}>{AI_OUTPUTS[output].label}</SelectItem>)}
          </SelectField>
        </Field>
        {config.output === 'json' && (
          <>
            <Field label="출력 단위">
              <SelectField value={config.scope} onValueChange={(value) => set({ scope: value as AiScope })}>
                {(Object.keys(AI_SCOPES) as AiScope[]).map((scope) => <SelectItem key={scope} value={scope}>{scope === 'line' ? `${INPUT_TYPES[input].label}마다` : AI_SCOPES[scope]}</SelectItem>)}
              </SelectField>
            </Field>
            <JsonFieldsEditor label="출력 필드" fields={config.fields} descriptionPlaceholder="AI에게 주는 설명" onChange={(fields) => set({ fields })} />
          </>
        )}
        {config.output === 'choice' && (
          <>
            <Field label="선택지 출처">
              <SelectField value={config.choice.source} onValueChange={(value) => set({ choice: { ...config.choice, source: value as ChoiceSource } })}>
                {(Object.keys(CHOICE_SOURCES) as ChoiceSource[]).map((source) => <SelectItem key={source} value={source}>{CHOICE_SOURCES[source]}</SelectItem>)}
              </SelectField>
            </Field>
            {config.choice.source === 'custom' && (
              <Field label="선택지">
                <ChoiceValues values={config.choice.values} onChange={(values) => set({ choice: { ...config.choice, values } })} />
              </Field>
            )}
            <ToggleRow label="‘해당 없음’ 허용" checked={config.choice.allowNone} onChange={(value) => set({ choice: { ...config.choice, allowNone: value } })} />
          </>
        )}
      </Section>

      <Section title={`문맥 · ${contextOn}개 켬`} defaultOpen={false}>
        <AiContextFields config={config} set={set} input={input} />
      </Section>

      <Section title="고급" defaultOpen={false}>
        <>
          {takesTemperature && (
            <Field label="온도">
              <Box asChild width="field"><NumberInput min={0} max={2} step={0.1} integer={false} optional value={config.temperature} placeholder="기본값" onValueChange={(temperature) => set({ temperature })} /></Box>
            </Field>
          )}
          <>
            <Field label={<Inline as="span" gap="tight">요청 단위<HelpTip>AI 요청 한 번에 항목을 어떻게 묶어 보낼지 정합니다.</HelpTip></Inline>}>
              <SelectField
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
                {INPUT_TYPES[input].batchModes.map((mode) => <SelectItem key={mode} value={mode}>{mode === 'unit' ? `${INPUT_TYPES[input].label} 하나씩` : BATCH_MODE_LABELS[mode]}</SelectItem>)}
              </SelectField>
            </Field>
            {(config.batch.mode === 'group' || config.batch.mode === 'whole') && (
              <Field
                label="요청 크기"
                description={config.batch.maxTokens === null ? '자동' : '직접 입력'}
                help="요청 한 번에 보내는 원문 양입니다. 클수록 빠르지만 놓치는 내용이 늘어납니다."
              >
                <Box asChild width="field-xl">
                  <Input
                    type="number"
                    min={500}
                    max={10_000_000}
                    value={config.batch.maxTokens ?? ''}
                    placeholder={autoLines.toLocaleString()}
                    onChange={(event) => set({ batch: { ...config.batch, maxTokens: numberOrNull(event.target.value) } })}
                  />
                </Box>
              </Field>
            )}
            {config.batch.mode === 'count' && (
              <Field label={`요청당 ${INPUT_TYPES[input].label} 수`}>
                <NumberInput min={1} max={1000} value={config.batch.size} onValueChange={(size) => size !== undefined && set({ batch: { ...config.batch, size } })} />
              </Field>
            )}
          </>
          <Field label="요청 제한 시간 (분)" help="요청 하나의 제한 시간입니다. 넘기면 그 대사들이 오류(시간 초과) 출구로 나갑니다. 다시 보내려면 오류 출구에 재요청 노드를 이으세요.">
            <Box asChild width="field"><NumberInput min={1} max={240} value={config.timeoutMinutes} onValueChange={(timeoutMinutes) => timeoutMinutes !== undefined && set({ timeoutMinutes })} /></Box>
          </Field>
        </>
      </Section>
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
      <Box spaceY="cozy">
        {lines ? <>
            <CountRow label={CONTEXT_FIELDS.precedingLines.label} help={CONTEXT_FIELDS.precedingLines.help} unit="줄" value={context.precedingLines} fallback={8} max={50} onChange={(value) => setContext({ precedingLines: value })} />
            {context.precedingLines > 0 && (
              <Box paddingLeft="comfortable">
                <ToggleRow label={CONTEXT_FIELDS.precedingTranslations.label} help={CONTEXT_FIELDS.precedingTranslations.help} checked={context.precedingTranslations} onChange={(value) => setContext({ precedingTranslations: value })} />
              </Box>
            )}
            <CountRow label={CONTEXT_FIELDS.previousScenes.label} help={CONTEXT_FIELDS.previousScenes.help} unit="개" value={context.previousScenes} fallback={1} max={10} onChange={(value) => setContext({ previousScenes: value })} />
        </> : (
            <CountRow label={CONTEXT_FIELDS.examples.label} help={CONTEXT_FIELDS.examples.help} unit="줄" value={context.examples} fallback={2} max={5} onChange={(value) => setContext({ examples: value })} />
        )}
      </Box>
      <Box spaceY="cozy" border="top" borderColor="subtle" paddingTop="normal">
        <ToggleRow label={CONTEXT_FIELDS.candidate.label} help={CONTEXT_FIELDS.candidate.help} checked={config.include.candidate} onChange={(value) => set({ include: { ...config.include, candidate: value } })} />
        <ToggleRow label={CONTEXT_FIELDS.glossary.label} help={CONTEXT_FIELDS.glossary.help} checked={context.glossary} onChange={(value) => setContext({ glossary: value })} />
        {lines && <ToggleRow label={CONTEXT_FIELDS.speech.label} help={CONTEXT_FIELDS.speech.help} checked={context.speech} onChange={(value) => setContext({ speech: value })} />}
        <ToggleRow label={CONTEXT_FIELDS.cast.label} help={CONTEXT_FIELDS.cast.help} checked={context.cast} onChange={(value) => setContext({ cast: value })} />
        <ToggleRow label={CONTEXT_FIELDS.characters.label} help={CONTEXT_FIELDS.characters.help} checked={context.characters} onChange={(value) => setContext({ characters: value })} />
        <ToggleRow label={CONTEXT_FIELDS.relationships.label} help={CONTEXT_FIELDS.relationships.help} checked={context.relationships} onChange={(value) => setContext({ relationships: value })} />
        <ToggleRow label={CONTEXT_FIELDS.documents.label} help={CONTEXT_FIELDS.documents.help} checked={context.documents} onChange={(value) => setContext({ documents: value })} />
      </Box>
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
    <Section title="입력" defaultOpen={input.previous || steps.length > 0}>
      <Box spaceY="normal">
        <CheckItem
          id={id('previous')}
          label="앞 단계 결과도 함께 보내기"
          title="선으로 이어진 바로 앞에서 결과를 내는 노드(AI·검사·스크립트·HTTP·모으기)의 결과를 대사마다 보냅니다. 조건·저장 노드는 건너뜁니다."
          checked={input.previous}
          onChange={(previous) => setInput({ previous, fields: [], ...(previous ? (gathered && batch ? { lines: false } : {}) : { lines: true }) })}
        />
        {input.previous && (
          <Box spaceY="normal" paddingLeft="spacious">
            <StepChips steps={steps} refs={refs} suffix="의 결과" />
            {names.length > 0 && (
              <Box spaceY="snug">
                <Text as="p" variant="caption" tone="muted">보낼 항목</Text>
                <Stack direction="row" wrap gapX="comfortable" gapY="condensed">
                  {names.map((name) => (
                    <CheckItem key={name} id={id(`field-${name}`)} label={name} checked={input.fields.includes(name)} onChange={(on) => setInput({ fields: on ? [...input.fields, name] : input.fields.filter((field) => field !== name) })} />
                  ))}
                </Stack>
                <Text as="p" variant="caption" tone="muted">아무것도 고르지 않으면 전부 보냅니다.</Text>
              </Box>
            )}
            {(batch || gathered) && <CheckItem id={id('lines')} label="대사도 함께 보내기" checked={input.lines} onChange={(lines) => setInput({ lines })} />}
          </Box>
        )}
      </Box>
    </Section>
  );
}
