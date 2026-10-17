/** Config of an AI node: model, prompt, context and outputs. */
import { Plus, Trash2, X } from 'lucide-react';
import { AI_OUTPUTS, ANALYSIS_SECTION_LABELS, ANALYSIS_SECTIONS, analysisSectionsOf, CONNECTION_KIND_INFO, contextConfigSchema, type AiOutput, type BatchConfig, type Capability, type JsonField, type WorkflowNode } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { ControlIdContext } from '@loca/ui';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { AiButton } from '@/components/ai-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@tanstack/react-router';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { Field, CountRow, ToggleRow, type AiNode, type NodeRefs } from '@/components/workflow/node-config/shared';

// ── AI node ───────────────────────────────────────────────────────────

export function AiConfig({ node, refs, onChange }: { node: AiNode; refs: NodeRefs; onChange: (node: WorkflowNode) => void }) {
  const config = node.config;
  // Saved workflows may predate a context setting; show its default.
  const context = contextConfigSchema.parse(config.context ?? {});
  const set = (patch: Partial<AiNode['config']>) => onChange({ ...node, config: { ...config, ...patch } });
  const need: Capability[] = config.output === 'verdict' ? ['generate', 'judge'] : ['generate'];
  const extras = config.extraModels;
  const chosenModels = new Set([config.model, ...extras].filter((choice) => choice.model).map((choice) => choice.model));
  const setExtra = (index: number, value: ModelValue) => set({ extraModels: extras.map((choice, i) => (i === index ? value : choice)) });
  const connection = refs.connections.find((item) => item.id === config.model.connectionId);
  // Temperature reaches API models only; agent CLIs choose their own.
  const takesTemperature = connection ? CONNECTION_KIND_INFO[connection.kind].transport !== 'cli' && connection.kind !== 'systemone' : false;
  const setField = (index: number, patch: Partial<JsonField>) => set({ fields: config.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)) });

  return (
    <>
      <Field label="출력 형태" hint={config.output === 'verdict' ? '통과 / 실패 출구가 생깁니다.' : '완료 출구로 나갑니다. 결과는 뒤 노드와 조건에서 outputs.' + node.id + ' 로 읽습니다.'}>
        <Select value={config.output} onValueChange={(value) => set({ output: value as AiOutput })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AI_OUTPUTS) as AiOutput[]).map((output) => (
              <SelectItem key={output} value={output}>
                {AI_OUTPUTS[output].label} <span className="text-muted-foreground">— {AI_OUTPUTS[output].description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {config.output === 'json' && (
        <Field label="필드">
          {/* Several controls per row: each names itself instead of taking the field's label. */}
          <ControlIdContext.Provider value={undefined}>
          <div className="space-y-2">
            {config.fields.map((field, index) => (
              <div key={index} className="flex min-w-0 items-center gap-1.5">
                <Input className="h-8 w-28 shrink-0 font-mono text-xs" value={field.name} placeholder="name" aria-label={`필드 ${index + 1} 이름`} onChange={(event) => setField(index, { name: event.target.value })} />
                <Select value={field.type} onValueChange={(value) => setField(index, { type: value as JsonField['type'] })}>
                  <SelectTrigger size="sm" className="w-24" aria-label={`필드 ${index + 1} 형식`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">문자</SelectItem>
                    <SelectItem value="number">숫자</SelectItem>
                    <SelectItem value="boolean">참/거짓</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-8 min-w-0 flex-1 text-xs" value={field.description} placeholder="설명 (AI에게 보임)" aria-label={`필드 ${index + 1} 설명`} onChange={(event) => setField(index, { description: event.target.value })} />
                <Button size="icon" variant="ghost" className="text-destructive" aria-label="필드 삭제" onClick={() => set({ fields: config.fields.filter((_, i) => i !== index) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => set({ fields: [...config.fields, { name: `field${config.fields.length + 1}`, type: 'string', description: '' }] })}>
              <Plus /> 필드 추가
            </Button>
          </div>
          </ControlIdContext.Provider>
        </Field>
      )}
      {config.output === 'analysis' && (
        <Field label="읽을 항목" hint="고른 항목만 묻고 저장합니다. 하나만 고르면 그 항목만 다시 분석하는 워크플로가 됩니다(대본 전체를 읽은 실행은 지난 분석의 손대지 않은 AI 항목을 그 항목만 바꿉니다).">
          <div className="grid grid-cols-2 gap-1.5">
            {ANALYSIS_SECTIONS.map((section) => {
              const picked = analysisSectionsOf(config.sections);
              const on = picked.includes(section);
              return (
                <label key={section} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={on}
                    // At least one stays picked; all picked is stored as "everything" (new sections join it).
                    disabled={on && picked.length === 1}
                    onCheckedChange={(value) => {
                      const next = value ? [...picked, section] : picked.filter((item) => item !== section);
                      set({ sections: next.length === ANALYSIS_SECTIONS.length ? undefined : ANALYSIS_SECTIONS.filter((item) => next.includes(item)) });
                    }}
                  />
                  {ANALYSIS_SECTION_LABELS[section]}
                </label>
              );
            })}
          </div>
        </Field>
      )}
      <Field
        label="AI 모델"
        hint={
          <>
            {connection?.fallback && <span className="block">이 연결이 막히면 연결 설정의 ‘막히면’으로 넘깁니다.</span>}
            시간 제한·시도 횟수·최대 출력은{' '}
            <Link to="/p/$projectId/ai/connections" params={{ projectId: refs.projectId }} search={{ conn: config.model.connectionId || undefined }} className="underline">
              AI 연결 설정
            </Link>
            에서 정합니다.
            {config.output === 'verdict' && ' 판정에는 System One도 쓸 수 있습니다.'}
            {extras.length > 0 && <span className="mt-1 block">요청마다 칸이 빈 계정의 모델로 보냅니다. 같은 모델의 다른 계정을 붙이면 처리량만 늘어납니다.</span>}
            {config.output === 'candidate' && chosenModels.size > 1 && <span className="mt-1 block text-warning">서로 다른 모델이 번역을 나누면 장면마다 문체가 달라질 수 있습니다.</span>}
          </>
        }
      >
        <div className="space-y-1.5">
          <ModelPicker need={need} value={config.model} onChange={(model) => set({ model })} />
          {extras.map((extra, index) => (
            <div key={index} className="flex min-w-0 items-center gap-1.5">
              <ModelPicker need={need} value={extra} onChange={(value) => setExtra(index, value)} className="min-w-0" />
              <Button size="icon" variant="ghost" className="shrink-0" aria-label="함께 나눌 모델 빼기" onClick={() => set({ extraModels: extras.filter((_, i) => i !== index) })}>
                <X />
              </Button>
            </div>
          ))}
          <Button variant="outline" onClick={() => set({ extraModels: [...extras, { connectionId: '', model: '' }] })} disabled={extras.some((choice) => !choice.model)}>
            <Plus /> 함께 나눌 모델
          </Button>
        </div>
      </Field>
      {takesTemperature && (
        <Field label="온도 (고급)" hint="비우면 모델 기본값. 낮을수록 같은 입력에 같은 답을 냅니다.">
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            className="w-28"
            value={config.temperature ?? ''}
            placeholder="기본값"
            onChange={(event) => set({ temperature: event.target.value === '' ? undefined : Math.min(2, Math.max(0, Number(event.target.value))) })}
          />
        </Field>
      )}
      <Field
        label="지시문 (이 단계에서 할 일)"
        action={
          <AiButton variant="ghost" prompt={`이 AI 노드의 지시문을 ${config.instructions.trim() ? '다듬어줘' : '작성해줘'}.`}>
            {config.instructions.trim() ? 'AI로 다듬기' : 'AI로 작성'}
          </AiButton>
        }
      >
        <Textarea
          value={config.instructions}
          onChange={(event) => set({ instructions: event.target.value })}
          className="min-h-32 text-xs"
          placeholder={config.output === 'analysis' ? '항목마다 무엇을 낼지는 기본 규칙이 정합니다. 여기에는 덧붙일 지시만 씁니다 (예: 인물 프로필은 세 문장 이내로).' : undefined}
        />
      </Field>
      {config.output === 'candidate' && (
        <Field label="기존 번역">
          <Select value={config.include.candidate ? 'revise' : 'fresh'} onValueChange={(value) => set({ include: { ...config.include, candidate: value === 'revise' } })}>
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
      <Separator />
      {config.output === 'analysis' ? (
        <p className="text-xs text-muted-foreground">작품 분석은 읽는 대본 자체가 문맥입니다. 사람이 정한 인물 이름만 함께 보내 같은 이름을 쓰게 합니다.</p>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs font-medium">문맥</p>
          <p className="text-xs text-muted-foreground">확정된 자료만 들어갑니다. 실제로 들어간 것은 대사 패널의 AI 문맥 탭에서 봅니다.</p>
          <ToggleRow label="사람이 확정한 것만 (✦ 빼기)" checked={context.humanOnly} onChange={(value) => set({ context: { ...context, humanOnly: value } })} />
          <ToggleRow label="용어집" checked={context.glossary} onChange={(value) => set({ context: { ...context, glossary: value } })} />
          <ToggleRow label="청자·말투 규칙" checked={context.speech} onChange={(value) => set({ context: { ...context, speech: value } })} />
          <ToggleRow label="앞 단계 지적 사항" checked={config.include.issues} onChange={(value) => set({ include: { ...config.include, issues: value } })} />
          <CountRow label="앞 대사" unit="줄" value={context.precedingLines} fallback={8} max={50} onChange={(value) => set({ context: { ...context, precedingLines: value } })} />
          {context.precedingLines > 0 && (
            <div className="pl-4">
              <ToggleRow label="앞 대사의 현재 번역도" checked={context.precedingTranslations} onChange={(value) => set({ context: { ...context, precedingTranslations: value } })} />
            </div>
          )}
          <CountRow label="이전 장면" unit="개" value={context.previousScenes} fallback={1} max={10} onChange={(value) => set({ context: { ...context, previousScenes: value } })} />
          <ToggleRow label="인물 명단" checked={context.cast} onChange={(value) => set({ context: { ...context, cast: value } })} />
          <ToggleRow label="인물 프로필" checked={context.characters} onChange={(value) => set({ context: { ...context, characters: value } })} />
          <ToggleRow label="인물 관계" checked={context.relationships} onChange={(value) => set({ context: { ...context, relationships: value } })} />
          <ToggleRow label="작품 문서" checked={context.documents} onChange={(value) => set({ context: { ...context, documents: value } })} />
          <Field label="문맥 상한 (토큰, 추정)" hint="넘치면 덜 중요한 것부터 빼고 실행 기록에 남깁니다.">
            <Input type="number" min={500} max={200000} step={500} value={context.maxTokens} onChange={(event) => set({ context: { ...context, maxTokens: Number(event.target.value) } })} />
          </Field>
        </div>
      )}
      <Separator />
      <div className="grid grid-cols-2 gap-3">
        <Field label="묶음 단위">
          <Select
            value={config.batch.mode}
            // 대본 전체 reads up to 300k tokens per request; the other modes go back to their usual size.
            onValueChange={(value) => set({ batch: { ...config.batch, mode: value as BatchConfig['mode'], maxTokens: value === 'whole' ? Math.max(config.batch.maxTokens, 300_000) : Math.min(config.batch.maxTokens, 6_000) } })}
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
          <Field label="요청당 최대 토큰 (추정)" hint="넘는 대본은 장면 경계에서 나눠 읽습니다.">
            <Input type="number" min={500} max={1_000_000} step={10_000} value={config.batch.maxTokens} onChange={(event) => set({ batch: { ...config.batch, maxTokens: Number(event.target.value) } })} />
          </Field>
        )}
        {config.batch.mode !== 'unit' && config.batch.mode !== 'whole' && (
          <Field label="최대 묶음 크기">
            <Input type="number" min={1} max={200} value={config.batch.size} onChange={(event) => set({ batch: { ...config.batch, size: Number(event.target.value) } })} />
          </Field>
        )}
      </div>
    </>
  );
}
