import { useEffect, useState } from 'react';
import { AUTO_MARKS, type AutoMark, CONDITION_MARK_IDS } from '@tw/shared';
import { useMutation } from '@tanstack/react-query';
import { Play, Plus, Trash2, X } from 'lucide-react';
import {
  AI_OUTPUTS,
  CONNECTION_KIND_INFO,
  contextConfigSchema,
  FUNCTIONS,
  NODE_TYPES,
  nodeName,
  type AiOutput,
  type Capability,
  type FunctionName,
  type JsonField,
  type WorkflowIssue,
  type WorkflowNode,
} from '@tw/shared';
import { MarkChip, StatusDot, TagChip } from '@/components/status';
import { AiConfirmNote } from '@/components/settings/ai-confirm';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { AiButton } from '@/components/ai-button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@tanstack/react-router';
import { client, unwrap } from '@/lib/api';
import { nodeIcon } from './node-view';
import { PaneHeader } from '@/components/pane-header';
import { ModelPicker, type ModelValue } from '@/components/model-picker';

type AiNode = Extract<WorkflowNode, { type: 'ai' }>;
type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;
type ConditionNode = Extract<WorkflowNode, { type: 'condition' }>;

export interface NodeRefs {
  projectId: string;
  statuses: { id: string; name: string; color: string; humanOnly?: boolean }[];
  tags: { id: string; name: string; color: string }[];
  connections: { id: string; name: string; kind: keyof typeof CONNECTION_KIND_INFO; baseUrl: string | null; fallback: { connectionId: string; model: string } | null }[];
  nodes: WorkflowNode[];
}

function Field({ label, hint, action, children }: { label: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {action}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A context item counted in lines or scenes: a switch like the others, with the count beside it while on (0 = off). */
function CountRow({ label, unit, value, fallback, max, onChange }: { label: string; unit: string; value: number; fallback: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        {value > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input type="number" min={1} max={max} value={value} onChange={(event) => onChange(Math.max(1, Math.min(max, Number(event.target.value) || 1)))} className="h-7 w-14 text-right" aria-label={`${label} 수`} />
            {unit}
          </span>
        )}
        <Switch checked={value > 0} onCheckedChange={(on) => onChange(on ? fallback : 0)} aria-label={label} />
      </span>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Edits one node's config. Every change goes straight into the draft; saving is separate. */
export function NodeConfig({ node, issues, refs, readOnly, onChange, onDelete, onClose }: {
  node: WorkflowNode;
  issues: WorkflowIssue[];
  refs: NodeRefs;
  readOnly?: boolean;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const Icon = nodeIcon(node);
  const description = node.type === 'function' ? (FUNCTIONS[node.config.fn as FunctionName]?.description ?? '') : node.type === 'ai' ? AI_OUTPUTS[node.config.output].description : NODE_TYPES[node.type].description;

  return (
    <div className="flex h-full flex-col">
      <PaneHeader icon={<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />} title={nodeName(node)} subtitle={description} onClose={onClose} />
      <ScrollArea className="min-h-0 flex-1">
        <fieldset disabled={readOnly} className="space-y-5 p-4">
          {issues.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
              {issues.map((issue, index) => (
                <li key={index} className={issue.level === 'error' ? 'text-destructive' : 'text-warning'}>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <Field label="이름" hint={<span className="font-mono">id: {node.id}</span>}>
            <Input value={node.label ?? ''} placeholder={nodeName({ ...node, label: undefined } as WorkflowNode)} onChange={(event) => onChange({ ...node, label: event.target.value || undefined })} />
          </Field>

          {node.type === 'entry' && (
            <Field label="들어올 대사의 상태" hint="선택한 상태 중 하나인 대사만 실행 대상이 됩니다. 아무것도 고르지 않으면 범위 안의 모든 대사.">
              <div className="space-y-1.5">
                {refs.statuses.map((status) => (
                  <label key={status.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={node.config.statusIds.includes(status.id)}
                      onCheckedChange={(checked) => onChange({ ...node, config: { statusIds: checked ? [...node.config.statusIds, status.id] : node.config.statusIds.filter((id) => id !== status.id) } })}
                    />
                    <StatusDot color={status.color} /> {status.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          {node.type === 'ai' && <AiConfig node={node} refs={refs} onChange={onChange} />}
          {node.type === 'function' && <FunctionConfig node={node} refs={refs} readOnly={readOnly} onChange={onChange} />}
          {node.type === 'condition' && <ConditionEditor node={node} nodes={refs.nodes} readOnly={readOnly} onChange={onChange} />}
        </fieldset>
      </ScrollArea>
      {!readOnly && node.type !== 'entry' && (
        <div className="border-t p-3">
          <Button variant="ghost" className="text-destructive" onClick={onDelete}>
            <Trash2 /> 노드 삭제
          </Button>
        </div>
      )}
    </div>
  );
}

// ── AI node ───────────────────────────────────────────────────────────

function AiConfig({ node, refs, onChange }: { node: AiNode; refs: NodeRefs; onChange: (node: WorkflowNode) => void }) {
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
          <div className="space-y-2">
            {config.fields.map((field, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input className="h-8 w-28 font-mono text-xs" value={field.name} placeholder="name" onChange={(event) => setField(index, { name: event.target.value })} />
                <Select value={field.type} onValueChange={(value) => setField(index, { type: value as JsonField['type'] })}>
                  <SelectTrigger size="sm" className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">문자</SelectItem>
                    <SelectItem value="number">숫자</SelectItem>
                    <SelectItem value="boolean">참/거짓</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-8 flex-1 text-xs" value={field.description} placeholder="설명 (AI에게 보임)" onChange={(event) => setField(index, { description: event.target.value })} />
                <Button size="icon" variant="ghost" className="text-destructive" aria-label="필드 삭제" onClick={() => set({ fields: config.fields.filter((_, i) => i !== index) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => set({ fields: [...config.fields, { name: `field${config.fields.length + 1}`, type: 'string', description: '' }] })}>
              <Plus /> 필드 추가
            </Button>
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
            <div key={index} className="flex items-center gap-1.5">
              <ModelPicker need={need} value={extra} onChange={(value) => setExtra(index, value)} />
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
        <Textarea value={config.instructions} onChange={(event) => set({ instructions: event.target.value })} className="min-h-32 text-xs" />
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
      <Separator />
      <div className="grid grid-cols-2 gap-3">
        <Field label="묶음 단위">
          <Select value={config.batch.mode} onValueChange={(value) => set({ batch: { ...config.batch, mode: value as 'unit' | 'group' | 'count' } })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="group">장면별</SelectItem>
              <SelectItem value="count">개수별</SelectItem>
              <SelectItem value="unit">대사 하나씩</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {config.batch.mode !== 'unit' && (
          <Field label="최대 묶음 크기">
            <Input type="number" min={1} max={200} value={config.batch.size} onChange={(event) => set({ batch: { ...config.batch, size: Number(event.target.value) } })} />
          </Field>
        )}
      </div>
    </>
  );
}

// ── function node ─────────────────────────────────────────────────────

function FunctionConfig({ node, refs, readOnly, onChange }: { node: FunctionNode; refs: NodeRefs; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
  const fn = node.config.fn as FunctionName;
  const info = FUNCTIONS[fn];
  if (!info) return <p className="text-sm text-destructive">알 수 없는 함수입니다: {node.config.fn}</p>;
  // Show defaults for anything not set yet; only what the user touches is written back.
  const parsed = info.params.safeParse(node.config.params);
  const params = (parsed.success ? parsed.data : info.params.parse({})) as Record<string, unknown>;
  const setMany = (patch: Record<string, unknown>) => onChange({ ...node, config: { ...node.config, params: { ...params, ...patch } } });
  const set = (key: string, value: unknown) => setMany({ [key]: value });

  switch (fn) {
    case 'formatCheck':
      return (
        <div className="space-y-2.5">
          <ToggleRow label="자리표시자 보존 (프로젝트 설정 › 형식 규칙)" checked={params.placeholders as boolean} onChange={(value) => set('placeholders', value)} />
          <ToggleRow label="서식 태그 보존 (프로젝트 설정 › 형식 규칙)" checked={params.tags as boolean} onChange={(value) => set('tags', value)} />
          <ToggleRow label="줄바꿈 수 일치" checked={params.newlines as boolean} onChange={(value) => set('newlines', value)} />
          <ToggleRow label="빈 번역 금지" checked={params.emptyText as boolean} onChange={(value) => set('emptyText', value)} />
        </div>
      );
    case 'glossaryCheck':
      return <p className="text-sm text-muted-foreground">설정할 것이 없습니다. 실패 이유는 다음 AI 노드의 "지적 사항"으로 전달됩니다.</p>;
    case 'setStatus':
      return <SetStatusConfig params={params} refs={refs} set={set} setMany={setMany} />;
    case 'addTerms': {
      const sources = refs.nodes.filter((other) => other.type === 'ai' && other.config.output === 'terms');
      return (
        <>
        <Field label="용어를 가져올 AI 노드" hint="이미 용어집에 있는 원문은 건너뜁니다.">
          <Select value={(params.fromNodeId as string) || 'latest'} onValueChange={(value) => set('fromNodeId', value === 'latest' ? '' : value)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">가장 최근 용어 출력</SelectItem>
              {sources.map((other) => (
                <SelectItem key={other.id} value={other.id}>
                  {nodeName(other)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <AiConfirmNote projectId={refs.projectId} kinds={['terms']} />
        </>
      );
    }
    case 'applyKnowledge': {
      const sources = refs.nodes.filter((other) => other.type === 'ai' && other.config.output === 'knowledge');
      return (
        <>
          <Field label="자료 변경을 가져올 AI 노드" hint="사람이 정한 자료는 바꾸지 않습니다. 다른 의견은 후보로 남깁니다.">
            <Select value={(params.fromNodeId as string) || 'latest'} onValueChange={(value) => set('fromNodeId', value === 'latest' ? '' : value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">가장 최근 자료 변경 출력</SelectItem>
                {sources.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {nodeName(other)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <AiConfirmNote projectId={refs.projectId} kinds={['characters', 'relationships', 'events', 'speechRules']} />
        </>
      );
    }
    case 'setListener': {
      const sources = refs.nodes.filter((other) => other.type === 'ai' && other.config.output === 'listener');
      return (
        <Field label="청자를 가져올 AI 노드" hint="사람이 정한 청자는 바꾸지 않습니다. 확신도 0.9 미만은 문맥에서 ‘미상’으로 다룹니다.">
          <Select value={(params.fromNodeId as string) || 'latest'} onValueChange={(value) => set('fromNodeId', value === 'latest' ? '' : value)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">가장 최근 청자 출력</SelectItem>
              {sources.map((other) => (
                <SelectItem key={other.id} value={other.id}>
                  {nodeName(other)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    }
    case 'http':
      return <HttpConfig params={params} refs={refs} set={set} />;
    case 'script':
      return <ScriptConfig params={params} projectId={refs.projectId} readOnly={readOnly} set={set} />;
  }
}

function SetStatusConfig({ params, refs, set, setMany }: { params: Record<string, unknown>; refs: NodeRefs; set: (key: string, value: unknown) => void; setMany: (patch: Record<string, unknown>) => void }) {
  const add = params.addTagIds as string[], remove = params.removeTagIds as string[];
  return (
    <>
      <Field label="상태를 바꾸기">
        <Select value={(params.statusId as string) ?? 'keep'} onValueChange={(value) => set('statusId', value === 'keep' ? undefined : value)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">바꾸지 않음</SelectItem>
            {refs.statuses.map((status) => (
              <SelectItem key={status.id} value={status.id}>
                <StatusDot color={status.color} /> {status.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {refs.statuses.find((status) => status.id === params.statusId)?.humanOnly && <p className="text-xs text-warning">사람만 지정 상태 → 실행하면 검토함으로 갑니다.</p>}
      <ToggleRow label="현재 후보를 대표 번역으로 적용" checked={params.applyCandidate as boolean} onChange={(value) => set('applyCandidate', value)} />
      {refs.tags.length > 0 && (
        <Field label="태그" hint="누를 때마다 추가 → 제거 → 그대로 순서로 바뀝니다.">
          <div className="flex flex-wrap gap-1.5">
            {refs.tags.map((tag) => {
              const on = add.includes(tag.id), off = remove.includes(tag.id);
              return (
                <Button
                  key={tag.id}
                  variant={on || off ? 'secondary' : 'outline'}
                  aria-pressed={on || off}
                  onClick={() =>
                    setMany({
                      addTagIds: on ? add.filter((id) => id !== tag.id) : off ? add : [...add, tag.id],
                      removeTagIds: on ? [...remove, tag.id] : remove.filter((id) => id !== tag.id),
                    })
                  }
                >
                  {on ? '+ ' : off ? '− ' : ''}
                  <TagChip tag={tag} />
                </Button>
              );
            })}
          </div>
        </Field>
      )}
    </>
  );
}

const PLACEHOLDERS = '{{candidate}}, {{unit.source}}, {{unit.speaker}}, {{unit.key}}, {{outputs.<노드ID>.<필드>}}';

function HttpConfig({ params, refs, set }: { params: Record<string, unknown>; refs: NodeRefs; set: (key: string, value: unknown) => void }) {
  const tools = refs.connections.filter((connection) => connection.kind === 'http');
  const selected = tools.find((tool) => tool.id === params.connectionId);
  return (
    <>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <Field label="메서드">
          <Select value={params.method as string} onValueChange={(value) => set('method', value)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="주소">
          <Input className="font-mono text-xs" value={params.url as string} placeholder="https://api.example.com/spell" onChange={(event) => set('url', event.target.value)} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">주소에도 {'{{unit.key}}'} 같은 값을 넣을 수 있습니다(자동으로 URL 인코딩).</p>
      <Field label="API 키 (선택)" hint={tools.length ? (selected ? 'API 키에 정한 헤더 형식으로 키를 붙여 보냅니다' : '키가 필요 없는 공개 API면 비워 둡니다') : '키가 필요한 API면 워크플로 › API 키에서 먼저 추가하세요.'}>
        <Select value={(params.connectionId as string) || 'none'} onValueChange={(value) => set('connectionId', value === 'none' ? '' : value)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">키 없음</SelectItem>
            {tools.map((tool) => (
              <SelectItem key={tool.id} value={tool.id}>
                {tool.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {params.method === 'POST' && (
        <Field label="요청 본문 (JSON)" hint={`대사마다 바뀌는 값: ${PLACEHOLDERS}`}>
          <Textarea className="min-h-28 font-mono text-xs" spellCheck={false} value={params.body as string} onChange={(event) => set('body', event.target.value)} />
        </Field>
      )}
      <Field label="응답에서 읽을 위치" hint="예: result.text — 비우면 응답 전체">
        <Input className="font-mono text-xs" value={params.resultPath as string} onChange={(event) => set('resultPath', event.target.value)} />
      </Field>
      <Field label="결과 쓰임">
        <Select value={params.mode as string} onValueChange={(value) => set('mode', value)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="candidate">새 번역 후보로 (예: 맞춤법 교정 결과)</SelectItem>
            <SelectItem value="verdict">통과/실패 판정으로 (참·거짓 값)</SelectItem>
            <SelectItem value="data">데이터로만 저장</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="제한 시간(초)">
        <Input type="number" min={1} max={300} value={params.timeoutSeconds as number} onChange={(event) => set('timeoutSeconds', Number(event.target.value))} />
      </Field>
    </>
  );
}

function ScriptConfig({ params, projectId, readOnly, set }: { params: Record<string, unknown>; projectId: string; readOnly?: boolean; set: (key: string, value: unknown) => void }) {
  const ports = params.ports as string[];
  const [portsText, setPortsText] = useState(ports.join(', '));
  const test = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['script-test'].$post({ param: { projectId }, json: { code: params.code as string, ports } })),
  });
  return (
    <>
      <Field label="출구" hint="쉼표로 구분. 스크립트가 반환하는 port 값과 같아야 합니다. 오류 출구는 자동으로 붙습니다.">
        <Input
          className="font-mono text-xs"
          value={portsText}
          onChange={(event) => setPortsText(event.target.value)}
          onBlur={() => {
            const next = portsText.split(',').map((port) => port.trim()).filter(Boolean);
            if (next.length) set('ports', [...new Set(next)]);
            else setPortsText(ports.join(', '));
          }}
        />
      </Field>
      <Field
        label="코드 (JavaScript)"
        action={
          <AiButton variant="ghost" send={false} prompt="이 스크립트 노드의 코드를 작성해줘. 하는 일: ">
            AI로 작성
          </AiButton>
        }
        hint="격리된 샌드박스에서 실행됩니다. 네트워크·파일 접근이 없고 2초·32MB로 제한됩니다. 외부 호출은 HTTP 함수를 쓰세요.">
        <Textarea className="min-h-56 font-mono text-xs leading-relaxed" spellCheck={false} value={params.code as string} onChange={(event) => set('code', event.target.value)} />
      </Field>
      {!readOnly && (
        <div className="space-y-2">
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            <Play /> 첫 대사로 시험 실행
          </Button>
          {test.data && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-xs">
              {test.data.ok
                ? `출구: ${test.data.port}${test.data.validPort ? '' : ' (선언하지 않은 출구!)'}  ·  ${test.data.ms}ms\n${JSON.stringify(test.data.result, null, 2)}`
                : `오류: ${test.data.error}`}
              {'\n\n입력:\n'}
              {JSON.stringify(test.data.input, null, 2)}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

// ── condition node ────────────────────────────────────────────────────

/** Nodes whose output has a `passed` flag a condition can test. */
const hasVerdict = (node: WorkflowNode) =>
  (node.type === 'ai' && node.config.output === 'verdict') ||
  (node.type === 'function' && (node.config.fn === 'formatCheck' || node.config.fn === 'glossaryCheck' || (node.config.fn === 'http' && (node.config.params as { mode?: string }).mode === 'verdict')));

/** Common conditions as a form; anything else is plain JSON Logic. */
function ConditionEditor({ node, nodes, readOnly, onChange }: { node: ConditionNode; nodes: WorkflowNode[]; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
  const [text, setText] = useState(() => JSON.stringify(node.config.expression ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(JSON.stringify(node.config.expression ?? null, null, 2));
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (expression: unknown, description: string) => {
    setText(JSON.stringify(expression, null, 2));
    setError(null);
    onChange({ ...node, config: { expression, description } });
  };
  const others = nodes.filter((other) => other.id !== node.id && other.type !== 'entry' && other.type !== 'end');
  const verdicts = nodes.filter(hasVerdict);
  const [target, setTarget] = useState(others.find((other) => other.id === 'review')?.id ?? others[0]?.id ?? '');
  const [limit, setLimit] = useState(3);
  const [passNode, setPassNode] = useState(verdicts[0]?.id ?? '');
  const [mark, setMark] = useState<AutoMark>(CONDITION_MARK_IDS[0]);
  const label = (id: string) => {
    const other = nodes.find((candidate) => candidate.id === id);
    return other ? nodeName(other) : id;
  };

  return (
    <div className="space-y-4">
      <Field
        label="설명"
        action={
          !readOnly && (
            <AiButton variant="ghost" send={false} prompt="이 조건 노드의 조건을 이렇게 바꿔줘: ">
              말로 조건 쓰기
            </AiButton>
          )
        }
      >
        <Input value={node.config.description} onChange={(event) => onChange({ ...node, config: { ...node.config, description: event.target.value } })} />
      </Field>
      {!readOnly && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-xs font-medium">자주 쓰는 조건</p>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="노드" />
              </SelectTrigger>
              <SelectContent>
                {others.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {nodeName(other)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            방문
            <Input type="number" min={1} className="h-8 w-14" value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
            회 미만
            <Button variant="secondary" disabled={!target} onClick={() => apply({ '<': [{ var: `visits.${target}` }, limit] }, `'${label(target)}' 방문이 ${limit}회 미만`)}>
              적용
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">예: 'AI 검수' 방문 3회 미만 → 거짓 출구를 사람 확인에 연결하면 "검수 3번 불통이면 사람 검토".</p>
          {verdicts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <Select value={passNode} onValueChange={setPassNode}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {verdicts.map((other) => (
                    <SelectItem key={other.id} value={other.id}>
                      {nodeName(other)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              을(를) 통과했음
              <Button variant="secondary" onClick={() => apply({ '==': [{ var: `outputs.${passNode}.passed` }, true] }, `'${label(passNode)}' 통과`)}>
                적용
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            줄에
            <Select value={mark} onValueChange={(value) => setMark(value as AutoMark)}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_MARK_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    <MarkChip mark={id} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            표시가 있음
            <Button variant="secondary" onClick={() => apply({ in: [mark, { var: 'unit.marks' }] }, `줄에 #${AUTO_MARKS[mark].name} 표시가 있음`)}>
              적용
            </Button>
          </div>
          <Button variant="outline" onClick={() => apply({ '==': [{ var: 'unit.kind' }, 'ui'] }, 'UI 문자열')}>
            UI 문자열인가
          </Button>
        </div>
      )}
      <Field label="조건식 (JSON Logic)" hint={`읽을 수 있는 값: visits.<노드ID>, outputs.<노드ID>.<필드>, candidate, issues, unit.kind, unit.speaker, unit.statusId, unit.tagIds, unit.marks (${CONDITION_MARK_IDS.join(' · ')})`}>
        <Textarea
          value={text}
          spellCheck={false}
          className="min-h-28 font-mono text-xs"
          onChange={(event) => {
            setText(event.target.value);
            try {
              onChange({ ...node, config: { ...node.config, expression: JSON.parse(event.target.value) } });
              setError(null);
            } catch {
              setError('JSON 형식이 아닙니다.');
            }
          }}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </Field>
    </div>
  );
}
