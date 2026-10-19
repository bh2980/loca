/** AI node settings, grouped by the user's task: model, instruction, output, advanced. */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { AI_OUTPUTS, AI_PRESETS, AI_SCOPES, CHOICE_SOURCES, CONNECTION_KIND_INFO, contextConfigSchema, nodeName, type AiOutput, type AiScope, type BatchConfig, type Capability, type ChoiceSource, type WorkflowNode } from '@tw/shared';
import { AdvancedDisclosure, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, InspectorSection } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { AiContextPanel } from '@/components/ai-context';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { client, unwrap } from '@/lib/api';
import { JsonFieldsEditor } from '@/components/workflow/node-config/json-fields-editor';
import { Field, CountRow, ToggleRow, type AiNode, type NodeRefs } from '@/components/workflow/node-config/shared';

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
  const batchLabel: Record<BatchConfig['mode'], string> = { group: '장면별', count: '개수별', unit: '대사 하나씩', whole: '대본 전체' };

  if (part === 'model') {
    return (
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
          {config.output === 'text' && chosenModels.size > 1 && <p className="text-xs text-warning">서로 다른 모델이 번역을 나누면 장면마다 문체가 달라질 수 있습니다.</p>}
          <Button variant="ghost" className="-ml-2 text-muted-foreground" disabled={!config.model.model || extras.some((choice) => !choice.model)} onClick={() => set({ extraModels: [...extras, { connectionId: '', model: '' }] })}>
            <Plus /> 모델
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <>
      <InspectorSection title="지시문" defaultOpen actions={
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" onClick={() => setExpanded(true)}>크게 열기</Button>
              <AiButton variant="ghost" prompt={`이 AI 노드의 지시문을 ${config.instructions.trim() ? '다듬어줘' : '작성해줘'}.`}>
                {config.instructions.trim() ? 'AI로 다듬기' : 'AI로 작성'}
              </AiButton>
            </div>
      }>
        <Textarea aria-label="지시문" value={config.instructions} onChange={(event) => set({ instructions: event.target.value })} className="min-h-28 text-sm" />
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{config.preset ? (preset ? `프리셋 · ${preset.label}` : `프리셋 · ${config.preset}`) : '프리셋 없음'}</span>
          <div className="flex shrink-0 items-center gap-1">
            {preset && <Button type="button" variant="ghost" onClick={() => setRefilling(true)}>다시 채우기</Button>}
            <Button type="button" variant="ghost" onClick={() => setPreviewing(true)}>프롬프트</Button>
          </div>
        </div>
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

      <InspectorSection title="고급">
        <div className="space-y-2.5">
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
          <div className="space-y-2">
            {config.output === 'text' && (
              <AdvancedDisclosure label="기존 번역">
                <Field label="방식">
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
              </AdvancedDisclosure>
            )}
            <AdvancedDisclosure label={`묶음 · ${batchLabel[config.batch.mode]}`}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="단위">
                  <Select
                    value={config.batch.mode}
                    onValueChange={(value) =>
                      set({
                        batch: {
                          ...config.batch,
                          mode: value as BatchConfig['mode'],
                          maxTokens:
                            value === 'whole'
                              ? Math.max(config.batch.maxTokens, 300_000)
                              : Math.min(config.batch.maxTokens, 6_000),
                        },
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">장면별</SelectItem>
                      <SelectItem value="count">개수별</SelectItem>
                      <SelectItem value="unit">대사 하나씩</SelectItem>
                      <SelectItem value="whole">대본 전체</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {config.batch.mode === 'whole' && (
                  <Field label="요청당 최대 토큰">
                    <Input
                      type="number"
                      min={500}
                      max={1_000_000}
                      step={10_000}
                      value={config.batch.maxTokens}
                      onChange={(event) =>
                        set({ batch: { ...config.batch, maxTokens: Number(event.target.value) } })
                      }
                    />
                  </Field>
                )}
                {config.batch.mode !== 'unit' && config.batch.mode !== 'whole' && (
                  <Field label="최대 크기">
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={config.batch.size}
                      onChange={(event) =>
                        set({ batch: { ...config.batch, size: Number(event.target.value) } })
                      }
                    />
                  </Field>
                )}
              </div>
            </AdvancedDisclosure>
            <AdvancedDisclosure label={`문맥 ${contextOn}개 켬 · 상한 ${context.maxTokens.toLocaleString()} 토큰`}>
              <div className="space-y-2.5">
                  <ToggleRow
                    label="확정된 것만"
                    checked={context.humanOnly}
                    onChange={(value) => set({ context: { ...context, humanOnly: value } })}
                  />
                  <ToggleRow
                    label="용어집"
                    checked={context.glossary}
                    onChange={(value) => set({ context: { ...context, glossary: value } })}
                  />
                  <ToggleRow
                    label="청자·말투"
                    checked={context.speech}
                    onChange={(value) => set({ context: { ...context, speech: value } })}
                  />
                  <ToggleRow
                    label="앞 단계 지적"
                    checked={config.include.issues}
                    onChange={(value) => set({ include: { ...config.include, issues: value } })}
                  />
                  <CountRow
                    label="앞 대사"
                    unit="줄"
                    value={context.precedingLines}
                    fallback={8}
                    max={50}
                    onChange={(value) => set({ context: { ...context, precedingLines: value } })}
                  />
                  {context.precedingLines > 0 && (
                    <div className="pl-4">
                      <ToggleRow
                        label="앞 대사 번역"
                        checked={context.precedingTranslations}
                        onChange={(value) =>
                          set({ context: { ...context, precedingTranslations: value } })
                        }
                      />
                    </div>
                  )}
                  <CountRow
                    label="이전 장면"
                    unit="개"
                    value={context.previousScenes}
                    fallback={1}
                    max={10}
                    onChange={(value) => set({ context: { ...context, previousScenes: value } })}
                  />
                  <ToggleRow
                    label="인물 명단"
                    checked={context.cast}
                    onChange={(value) => set({ context: { ...context, cast: value } })}
                  />
                  <ToggleRow
                    label="인물 프로필"
                    checked={context.characters}
                    onChange={(value) => set({ context: { ...context, characters: value } })}
                  />
                  <ToggleRow
                    label="인물 관계"
                    checked={context.relationships}
                    onChange={(value) => set({ context: { ...context, relationships: value } })}
                  />
                  <ToggleRow
                    label="문서"
                    checked={context.documents}
                    onChange={(value) => set({ context: { ...context, documents: value } })}
                  />
                  <Field label="문맥 상한">
                    <Input
                      type="number"
                      min={500}
                      max={200000}
                      step={500}
                      value={context.maxTokens}
                      onChange={(event) =>
                        set({ context: { ...context, maxTokens: Number(event.target.value) } })
                      }
                    />
                  </Field>
              </div>
            </AdvancedDisclosure>
          </div>
        </div>
      </InspectorSection>
    </>
  );
}
