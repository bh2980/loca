import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Plus, Trash2, X } from 'lucide-react';
import {
  AI_OUTPUTS,
  CONNECTION_KIND_INFO,
  FUNCTIONS,
  NODE_TYPES,
  humanDecisions,
  nodeName,
  type AiOutput,
  type FunctionName,
  type JsonField,
  type WorkflowIssue,
  type WorkflowNode,
} from '@tw/shared';
import { StatusDot, TagChip } from '@/components/status';
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

type AiNode = Extract<WorkflowNode, { type: 'ai' }>;
type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;
type ConditionNode = Extract<WorkflowNode, { type: 'condition' }>;
type HumanNode = Extract<WorkflowNode, { type: 'human' }>;

export interface NodeRefs {
  projectId: string;
  statuses: { id: string; name: string; color: string }[];
  tags: { id: string; name: string; color: string }[];
  profiles: { id: string; name: string; model: string; connectionId: string; effort?: string | null; fallbacks?: unknown[]; instructions?: string }[];
  connections: { id: string; name: string; kind: keyof typeof CONNECTION_KIND_INFO; baseUrl: string | null }[];
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
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
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
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{nodeName(node)}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="닫기">
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <fieldset disabled={readOnly} className="space-y-5 p-4">
          {issues.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
              {issues.map((issue, index) => (
                <li key={index} className={issue.level === 'error' ? 'text-destructive' : 'text-amber-700'}>
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
          {node.type === 'human' && (
            <>
              <Field label="검토자에게 보일 안내">
                <Textarea value={node.config.instructions} onChange={(event) => onChange({ ...node, config: { ...node.config, instructions: event.target.value } })} />
              </Field>
              <DecisionsEditor node={node} onChange={onChange} />
            </>
          )}
        </fieldset>
      </ScrollArea>
      {!readOnly && node.type !== 'entry' && (
        <div className="border-t p-3">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
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
  const set = (patch: Partial<AiNode['config']>) => onChange({ ...node, config: { ...config, ...patch } });
  const kindOf = (profileId: string) => refs.connections.find((connection) => connection.id === refs.profiles.find((profile) => profile.id === profileId)?.connectionId)?.kind;
  const usable = refs.profiles.filter((profile) => {
    const kind = kindOf(profile.id);
    const capabilities = kind ? CONNECTION_KIND_INFO[kind].capabilities : [];
    return capabilities.includes('generate') || (config.output === 'verdict' && capabilities.includes('judge'));
  });
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
                <Button size="icon" variant="ghost" className="size-8" aria-label="필드 삭제" onClick={() => set({ fields: config.fields.filter((_, i) => i !== index) })}>
                  <X />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => set({ fields: [...config.fields, { name: `field${config.fields.length + 1}`, type: 'string', description: '' }] })}>
              <Plus /> 필드 추가
            </Button>
          </div>
        </Field>
      )}
      <Field
        label="모델 프로필"
        hint={
          <>
            {(() => {
              const profile = refs.profiles.find((item) => item.id === config.profileId);
              const connection = refs.connections.find((item) => item.id === profile?.connectionId);
              return profile ? (
                <span className="block">
                  {connection?.name ?? '연결 없음'} · {profile.model}
                  {profile.effort && ` · 추론 ${profile.effort}`}
                  {!!profile.fallbacks?.length && ` · 대체 ${profile.fallbacks.length}개`}
                  {profile.instructions && ' · 공통 지시문 있음'}
                </span>
              ) : null;
            })()}
            어떤 모델을 쓸지는 프로필에서, 무엇을 시킬지는 아래 지시문에서 정합니다.{' '}
            <Link to="/p/$projectId/settings/ai" params={{ projectId: refs.projectId }} search={{ tab: 'profiles', profile: config.profileId || undefined }} className="underline">
              프로필 관리
            </Link>
            {config.output === 'verdict' && ' · 판정에는 System One도 쓸 수 있습니다.'}
          </>
        }
      >
        <Select value={config.profileId || undefined} onValueChange={(value) => set({ profileId: value })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="프로필 선택" />
          </SelectTrigger>
          <SelectContent>
            {usable.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name} <span className="text-muted-foreground">· {profile.model}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="지시문 (이 단계에서 할 일)"
        hint="프로필의 공통 지시문은 뒤에 덧붙습니다."
        action={
          <AiButton size="xs" variant="ghost" prompt={`이 AI 노드의 지시문을 ${config.instructions.trim() ? '다듬어줘' : '작성해줘'}.`}>
            {config.instructions.trim() ? 'AI로 다듬기' : 'AI로 작성'}
          </AiButton>
        }
      >
        <Textarea value={config.instructions} onChange={(event) => set({ instructions: event.target.value })} className="min-h-32 text-xs" />
      </Field>
      <div className="space-y-2.5">
        <p className="text-xs font-medium">대사마다 함께 보낼 것</p>
        <ToggleRow label="현재 번역 후보" checked={config.include.candidate} onChange={(value) => set({ include: { ...config.include, candidate: value } })} />
        <ToggleRow label="앞 단계의 지적 사항 (검수·검사 실패 이유)" checked={config.include.issues} onChange={(value) => set({ include: { ...config.include, issues: value } })} />
      </div>
      <Separator />
      <div className="space-y-2.5">
        <p className="text-xs font-medium">문맥</p>
        <ToggleRow label="용어집 (확정 용어 중 원문에 나온 것)" checked={config.context.glossary} onChange={(value) => set({ context: { ...config.context, glossary: value } })} />
        <ToggleRow label="항상 포함 문서 (스토리·세계관·문체)" checked={config.context.documents} onChange={(value) => set({ context: { ...config.context, documents: value } })} />
        <ToggleRow label="등장 인물 프로필" checked={config.context.characters} onChange={(value) => set({ context: { ...config.context, characters: value } })} />
        <ToggleRow label="인물 관계" checked={config.context.relationships} onChange={(value) => set({ context: { ...config.context, relationships: value } })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="선행 대사 수" hint="대사 그래프에서 앞에 오는 대사">
            <Input type="number" min={0} max={50} value={config.context.precedingLines} onChange={(event) => set({ context: { ...config.context, precedingLines: Number(event.target.value) } })} />
          </Field>
          <Field label="이전 장면 수" hint="장면 그래프에서 앞선 장면">
            <Input type="number" min={0} max={10} value={config.context.previousScenes} onChange={(event) => set({ context: { ...config.context, previousScenes: Number(event.target.value) } })} />
          </Field>
        </div>
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
        <ToggleRow label="자동 확정 (수락 없이 바로 용어집에 반영)" checked={params.autoConfirm as boolean} onChange={(value) => set('autoConfirm', value)} />
        <p className="text-[11px] text-muted-foreground">
          {params.autoConfirm ? '추가된 용어가 다음 AI 호출부터 문맥에 들어갑니다. 잘못 뽑힌 용어도 그대로 쓰이니 주의하세요.' : '추가된 용어는 ‘후보’입니다. 용어집의 후보 탭에서 수락해야 문맥에 쓰입니다.'}
        </p>
        </>
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
      <ToggleRow label="현재 후보를 대표 번역으로 적용" checked={params.applyCandidate as boolean} onChange={(value) => set('applyCandidate', value)} />
      {refs.tags.length > 0 && (
        <Field label="태그" hint="누를 때마다 추가 → 제거 → 그대로 순서로 바뀝니다.">
          <div className="flex flex-wrap gap-1.5">
            {refs.tags.map((tag) => {
              const on = add.includes(tag.id), off = remove.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="rounded border px-1.5 py-0.5 text-xs"
                  onClick={() =>
                    setMany({
                      addTagIds: on ? add.filter((id) => id !== tag.id) : off ? add : [...add, tag.id],
                      removeTagIds: on ? [...remove, tag.id] : remove.filter((id) => id !== tag.id),
                    })
                  }
                >
                  {on ? '+ ' : off ? '− ' : ''}
                  <TagChip tag={tag} />
                </button>
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
      <Field label="HTTP 연결" hint={tools.length ? selected?.baseUrl : '설정 › 연결·프로필 › 도구 연결에서 먼저 추가하세요.'}>
        <Select value={(params.connectionId as string) || undefined} onValueChange={(value) => set('connectionId', value)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="연결 선택" />
          </SelectTrigger>
          <SelectContent>
            {tools.map((tool) => (
              <SelectItem key={tool.id} value={tool.id}>
                {tool.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
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
        <Field label="경로">
          <Input className="font-mono text-xs" value={params.path as string} placeholder="spell/check" onChange={(event) => set('path', event.target.value)} />
        </Field>
      </div>
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
          <AiButton size="xs" variant="ghost" send={false} prompt="이 스크립트 노드의 코드를 작성해줘. 하는 일: ">
            AI로 작성
          </AiButton>
        }
        hint="격리된 샌드박스에서 실행됩니다. 네트워크·파일 접근이 없고 2초·32MB로 제한됩니다. 외부 호출은 HTTP 함수를 쓰세요.">
        <Textarea className="min-h-56 font-mono text-xs leading-relaxed" spellCheck={false} value={params.code as string} onChange={(event) => set('code', event.target.value)} />
      </Field>
      {!readOnly && (
        <div className="space-y-2">
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            <Play /> 첫 대사로 시험 실행
          </Button>
          {test.data && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-[11px]">
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

// ── human node ────────────────────────────────────────────────────

/**
 * The reviewer's buttons. Each one is an exit, so "확정 / 다시 번역 / 보류" can lead to different
 * status nodes. Ids stay fixed once created so existing connections keep working when renamed.
 */
function DecisionsEditor({ node, onChange }: { node: HumanNode; onChange: (node: WorkflowNode) => void }) {
  const decisions = humanDecisions(node);
  const set = (next: { id: string; label: string }[]) => onChange({ ...node, config: { ...node.config, decisions: next } });
  return (
    <Field label="결정 버튼 (각각 출구가 됩니다)" hint="첫 번째 버튼이 기본 결정(⌘↵)입니다. 출구를 상태 변경 노드에 이어 원하는 라벨로 보내세요.">
      <div className="space-y-1.5">
        {decisions.map((decision, index) => (
          <div key={decision.id} className="flex items-center gap-1.5">
            <Input className="h-8 text-sm" value={decision.label} onChange={(event) => set(decisions.map((item) => (item.id === decision.id ? { ...item, label: event.target.value } : item)))} />
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label={`${decision.label} 삭제`}
              disabled={decisions.length === 1}
              onClick={() => set(decisions.filter((item) => item.id !== decision.id))}
            >
              <X />
            </Button>
            {index === 0 && <span className="sr-only">기본</span>}
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => set([...decisions, { id: `d-${crypto.randomUUID().slice(0, 6)}`, label: '새 결정' }])}>
          <Plus /> 버튼 추가
        </Button>
      </div>
    </Field>
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
            <AiButton size="xs" variant="ghost" send={false} prompt="이 조건 노드의 조건을 이렇게 바꿔줘: ">
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
            <Button size="sm" variant="secondary" disabled={!target} onClick={() => apply({ '<': [{ var: `visits.${target}` }, limit] }, `'${label(target)}' 방문이 ${limit}회 미만`)}>
              적용
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">예: 'AI 검수' 방문 3회 미만 → 거짓 출구를 사람 확인에 연결하면 "검수 3번 불통이면 사람 검토".</p>
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
              <Button size="sm" variant="secondary" onClick={() => apply({ '==': [{ var: `outputs.${passNode}.passed` }, true] }, `'${label(passNode)}' 통과`)}>
                적용
              </Button>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => apply({ '==': [{ var: 'unit.kind' }, 'ui'] }, 'UI 문자열')}>
            UI 문자열인가
          </Button>
        </div>
      )}
      <Field label="조건식 (JSON Logic)" hint="읽을 수 있는 값: visits.<노드ID>, outputs.<노드ID>.<필드>, candidate, issues, unit.kind, unit.speaker, unit.statusId, unit.tagIds">
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
