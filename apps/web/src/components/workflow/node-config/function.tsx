/** Config of a function node: the function picked and its parameters (set status, HTTP call, script). */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Plus, Trash2 } from 'lucide-react';
import { APPLY_FUNCTION_NAMES, APPLY_TARGETS, applyIssues, DEFAULT_PARTICLE_PATTERN, formatPatternError, FUNCTIONS, functionTakes, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, JSON_FIELD_TYPE_LABELS, nodeName, PALETTE_FUNCTION_NAMES, previousSteps, type ApplyField, type ApplyFunctionName, type ApplyParams, type CustomFormatRule, type JsonFieldType, type WorkflowDefinition, type FunctionName, type JsonField, type WorkflowNode } from '@tw/shared';
import { Button, Input, InspectorActionRow, InspectorFields, InspectorList, InspectorResult, InspectorToggle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, StatusIcon, TagChip } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { cn } from '@/lib/utils';
import { AiRegexInput } from '@/components/ai-regex-input';
import { client, unwrap } from '@/lib/api';
import { JsonFieldsEditor } from '@/components/workflow/node-config/json-fields-editor';
import { Field, StepChips, refsSubject, type FunctionNode, type NodeRefs } from '@/components/workflow/node-config/shared';

// ── function node ─────────────────────────────────────────────────────

export function FunctionConfig({ node, refs, readOnly, onChange }: { node: FunctionNode; refs: NodeRefs; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
  const fn = node.config.fn as FunctionName;
  const info = FUNCTIONS[fn];
  if (!info) return <p className="text-sm text-destructive">알 수 없는 함수입니다: {node.config.fn}</p>;
  // Show defaults for anything not set yet; only what the user touches is written back.
  const parsed = info.params.safeParse(node.config.params);
  const params = (parsed.success ? parsed.data : info.params.parse({})) as Record<string, unknown>;
  const setMany = (patch: Record<string, unknown>) => onChange({ ...node, config: { ...node.config, params: { ...params, ...patch } } });
  const set = (key: string, value: unknown) => setMany({ [key]: value });
  const availableFns = PALETTE_FUNCTION_NAMES.includes(fn) ? PALETTE_FUNCTION_NAMES : [fn, ...PALETTE_FUNCTION_NAMES];
  const subject = refsSubject(refs);
  const switchable = (fn in APPLY_TARGETS ? APPLY_FUNCTION_NAMES : availableFns).filter((name) => name === fn || functionTakes(name, subject));

  const renderBody = () => {
    switch (fn) {
      case 'formatCheck':
        return <FormatCheckConfig params={params} refs={refs} set={set} />;
      case 'glossaryCheck':
        return <InspectorResult tone="info">설정 항목이 없습니다.</InspectorResult>;
      case 'fail':
        return (
          <Field label="남길 이유" hint="비워 두면 이 노드로 보낸 오류(앞 노드의 실패 이유)를 그대로 남깁니다.">
            <Input value={params.message as string} placeholder="앞 노드의 오류" readOnly={readOnly} onChange={(event) => set('message', event.target.value)} />
          </Field>
        );
      case 'setStatus':
        return <SetStatusConfig params={params} refs={refs} set={set} setMany={setMany} />;
      case 'setTermStatus':
        return <SetTermStatusConfig params={params} set={set} />;
      case 'http':
        return <HttpConfig params={params} refs={refs} set={set} />;
      case 'script':
        return <ScriptConfig params={params} projectId={refs.projectId} readOnly={readOnly} set={set} />;
      default:
        return fn in APPLY_TARGETS ? <ApplyConfig node={node} fn={fn as ApplyFunctionName} params={params as ApplyParams} refs={refs} setMany={setMany} /> : null;
    }
  };

  return (
    <InspectorFields>
      <Field label="함수">
        <Select
          value={fn}
          onValueChange={(nextFn) => {
            const keepLabel = node.label && node.label !== FUNCTIONS[fn]?.label ? node.label : undefined;
            onChange({ ...node, label: keepLabel, config: { fn: nextFn, params: {} } });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {switchable.map((name) => (
              <SelectItem key={name} value={name}>
                {FUNCTIONS[name]?.label ?? name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {renderBody()}
    </InspectorFields>
  );
}

const CUSTOM_RULE_KIND_LABELS: Record<CustomFormatRule['kind'], string> = {
  forbidden: '금지',
  preserve: '보존',
  targetRequired: '필수',
};

const LENGTH_LIMITS = [
  { key: 'maxChars', label: '최대 글자 수', step: 1 },
  { key: 'maxBytes', label: '최대 바이트', step: 1 },
  { key: 'maxLineChars', label: '한 줄 최대 글자 수', step: 1 },
  { key: 'maxLines', label: '최대 줄 수', step: 1 },
  { key: 'maxLengthRatio', label: '최대 길이 비율', step: 0.1 },
] as const;

function FormatCheckConfig({ params, refs, set }: { params: Record<string, unknown>; refs: NodeRefs; set: (key: string, value: unknown) => void }) {
  const customRules = (params.customRules as CustomFormatRule[] | undefined) ?? [];
  const updateRule = (index: number, patch: Partial<CustomFormatRule>) => {
    set('customRules', customRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };
  const removeRule = (index: number) => {
    set('customRules', customRules.filter((_, i) => i !== index));
  };
  const addRule = () => {
    set('customRules', [...customRules, { label: '', kind: 'forbidden' as const, pattern: '[A-Za-z]{4,}' }]);
  };

  return (
    <>
      <InspectorToggle label="치환자 보존" description="원문의 {이름} 같은 치환자가 번역에 그대로 있어야 합니다." checked={params.placeholders as boolean} onChange={(value) => set('placeholders', value)} />
      <InspectorToggle label="서식 태그 보존" description="원문의 서식 태그가 번역에 그대로 있어야 합니다." checked={params.tags as boolean} onChange={(value) => set('tags', value)} />
      <InspectorToggle label="줄바꿈 수 일치" description="원문과 번역의 줄바꿈 수가 같아야 합니다." checked={params.newlines as boolean} onChange={(value) => set('newlines', value)} />
      <InspectorToggle label="빈 번역 금지" description="번역이 비어 있으면 통과하지 못합니다." checked={params.emptyText as boolean} onChange={(value) => set('emptyText', value)} />
      <InspectorToggle label="숫자 누락" description="원문의 숫자가 번역에 빠졌는지 봅니다." checked={Boolean(params.numbers)} onChange={(value) => set('numbers', value)} />
      <InspectorToggle label="공백 불일치" description="앞뒤 공백이 원문과 다른지 봅니다." checked={Boolean(params.spaces)} onChange={(value) => set('spaces', value)} />
      <InspectorToggle label="변수 뒤 조사" description="치환자 바로 뒤 조사를 확인합니다." checked={Boolean(params.particles)} onChange={(value) => set('particles', value)} />

      {Boolean(params.particles) && (
        <Field label="조사 정규식" hint="비우면 기본 패턴을 씁니다.">
          <Input
            className="font-mono text-xs"
            placeholder={DEFAULT_PARTICLE_PATTERN}
            value={(params.particlesPattern as string) ?? ''}
            spellCheck={false}
            onChange={(event) => set('particlesPattern', event.target.value)}
          />
        </Field>
      )}

      {LENGTH_LIMITS.map(({ key, label, step }) => (
        <Field key={key} label={label} hint="비우면 확인하지 않습니다.">
          <Input type="number" min={0} step={step} placeholder="끔" value={(params[key] as number) || ''} onChange={(event) => set(key, Math.max(0, Number(event.target.value) || 0))} />
        </Field>
      ))}

      <Field label="금칙어" hint="쉼표로 구분합니다. 번역에 들어 있으면 걸립니다.">
        <Input value={(params.forbiddenWords as string) ?? ''} placeholder="예: 암튼, 대충" onChange={(event) => set('forbiddenWords', event.target.value)} />
      </Field>

      <Field label="정규식 규칙" hint="금지: 걸리면 안 되는 패턴 · 보존: 원문과 번역에 같이 있어야 하는 패턴 · 필수: 번역에 있어야 하는 패턴">
        <div className="space-y-2">
          <AiRegexInput
            projectId={refs.projectId}
            target="check"
            onRule={(rule) => {
              if (rule.kind === 'placeholder' || rule.kind === 'tag') return;
              set('customRules', [...customRules, { label: rule.label, kind: rule.kind, pattern: rule.pattern }]);
            }}
          />
          {customRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">규칙이 없습니다.</p>
          ) : (
            <InspectorList>
              {customRules.map((rule, index) => {
                const err = rule.pattern.trim() ? formatPatternError(rule.pattern) : '패턴을 입력하세요.';
                return (
                  <li key={index} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-1.5">
                      <Input className="flex-1" aria-label="규칙 이름" placeholder="예: 영어 잔존 금지" value={rule.label} onChange={(event) => updateRule(index, { label: event.target.value })} />
                      <Select value={rule.kind} onValueChange={(value) => updateRule(index, { kind: value as CustomFormatRule['kind'] })}>
                        <SelectTrigger className="w-24 shrink-0" aria-label="규칙 종류">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(CUSTOM_RULE_KIND_LABELS) as CustomFormatRule['kind'][]).map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {CUSTOM_RULE_KIND_LABELS[kind]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" aria-label="규칙 삭제" onClick={() => removeRule(index)}>
                        <Trash2 />
                      </Button>
                    </div>
                    <Input className="font-mono text-xs" aria-label="패턴" placeholder="예: [A-Za-z]{4,}" value={rule.pattern} spellCheck={false} onChange={(event) => updateRule(index, { pattern: event.target.value })} />
                    {err && <p className="text-xs text-destructive">{err}</p>}
                  </li>
                );
              })}
            </InspectorList>
          )}
          <Button type="button" variant="ghost" className="-ml-2 text-muted-foreground" onClick={addRule}>
            <Plus /> 규칙
          </Button>
        </div>
      </Field>
    </>
  );
}

function SetStatusConfig({ params, refs, set, setMany }: { params: Record<string, unknown>; refs: NodeRefs; set: (key: string, value: unknown) => void; setMany: (patch: Record<string, unknown>) => void }) {
  const add = params.addTagIds as string[], remove = params.removeTagIds as string[];
  return (
    <>
      <Field
        label="바꿀 상태"
        hint={refs.statuses.find((status) => status.id === params.statusId)?.humanOnly ? '워크플로가 지정하지 않는 상태 → 실행하면 검토함으로 갑니다.' : '고르지 않으면 상태는 그대로 두고 태그만 바꿉니다.'}>
        <Select value={(params.statusId as string) ?? 'keep'} onValueChange={(value) => set('statusId', value === 'keep' ? undefined : value)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">바꾸지 않음</SelectItem>
            {refs.statuses.map((status) => (
              <SelectItem key={status.id} value={status.id}>
                <StatusIcon status={status} /> {status.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {refs.tags.length > 0 && (
        <Field label="태그" hint="누르면 + 붙이기, 한 번 더 누르면 − 떼기, 또 누르면 그대로 둡니다.">
          <div className="flex flex-wrap gap-1.5">
            {refs.tags.map((tag) => {
              const on = add.includes(tag.id), off = remove.includes(tag.id);
              return (
                // The tag's own chip is the toggle (no pill in a button): faint until picked, + puts it on, − takes it off.
                <Button
                  key={tag.id}
                  variant="ghost"
                  size="inline"
                  className="h-auto p-0 hover:bg-transparent"
                  aria-pressed={on || off}
                  onClick={() =>
                    setMany({
                      addTagIds: on ? add.filter((id) => id !== tag.id) : off ? add : [...add, tag.id],
                      removeTagIds: on ? [...remove, tag.id] : remove.filter((id) => id !== tag.id),
                    })
                  }
                >
                  {(on || off) && <span className="text-xs text-muted-foreground">{on ? '+' : '−'}</span>}
                  <TagChip tag={tag} className={cn(!on && !off && 'opacity-50 hover:opacity-100', off && 'line-through')} />
                </Button>
              );
            })}
          </div>
        </Field>
      )}
    </>
  );
}

function SetTermStatusConfig({ params, set }: { params: Record<string, unknown>; set: (key: string, value: unknown) => void }) {
  return (
    <>
      <Field label="바꿀 상태">
        <Select value={params.status as string} onValueChange={(value) => set('status', value)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{KNOWLEDGE_STATUSES.map((status) => <SelectItem key={status} value={status}>{KNOWLEDGE_STATUS_LABELS[status]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <InspectorToggle label="제안으로 남기기" description="켜면 사용자가 제안을 수락해야 바뀝니다. 끄면 바로 바꿉니다." checked={Boolean(params.propose)} onChange={(value) => set('propose', value)} />
    </>
  );
}

const PLACEHOLDERS = '{{candidate}}, {{unit.source}}, {{unit.speaker}}, {{unit.key}}, {{outputs.<노드ID>.<필드>}}';

function HttpConfig({ params, refs, set }: { params: Record<string, unknown>; refs: NodeRefs; set: (key: string, value: unknown) => void }) {
  const tools = refs.connections.filter((connection) => connection.kind === 'http');
  return (
    <>
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
      <Field label="주소" hint="대사마다 바뀌는 값을 주소에도 쓸 수 있습니다.">
        <Input className="font-mono text-xs" value={params.url as string} placeholder="https://api.example.com/spell" onChange={(event) => set('url', event.target.value)} />
      </Field>
      <Field label="API 키" hint={tools.length ? '요청에 인증 정보를 붙일 때 고릅니다.' : '등록된 API 키가 없습니다. 워크플로 › API 키에서 추가하세요.'}>
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
        <Field label="본문" hint={`대사마다 바뀌는 값: ${PLACEHOLDERS}`}>
          <Textarea className="min-h-28 font-mono text-xs" spellCheck={false} value={params.body as string} onChange={(event) => set('body', event.target.value)} />
        </Field>
      )}
      <Field label="응답 경로" hint="응답 JSON에서 값을 꺼낼 경로입니다.">
        <Input className="font-mono text-xs" placeholder="result.text" value={params.resultPath as string} onChange={(event) => set('resultPath', event.target.value)} />
      </Field>
      <Field label="결과" hint="응답을 번역 후보, 통과/실패 판정, 또는 다음 노드가 읽는 데이터로 씁니다.">
        <Select value={params.mode as string} onValueChange={(value) => set('mode', value)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="candidate">번역 후보</SelectItem>
            <SelectItem value="verdict">판정</SelectItem>
            <SelectItem value="data">데이터</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="제한 시간" hint="초 단위, 1–300.">
        <Input type="number" min={1} max={300} value={params.timeoutSeconds as number} onChange={(event) => set('timeoutSeconds', Number(event.target.value))} />
      </Field>
    </>
  );
}

function ScriptConfig({ params, projectId, readOnly, set }: { params: Record<string, unknown>; projectId: string; readOnly?: boolean; set: (key: string, value: unknown) => void }) {
  const ports = params.ports as string[];
  const fields = (params.fields as JsonField[] | undefined) ?? [];
  const [portsText, setPortsText] = useState(ports.join(', '));
  const test = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['script-test'].$post({ param: { projectId }, json: { code: params.code as string, ports, fields } })),
  });
  return (
    <>
      <Field label="출구" hint="쉼표로 구분합니다. 코드가 이 중 하나를 반환합니다.">
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
        label="코드"
        action={
          <AiButton variant="ghost" send={false} prompt={`이 스크립트 노드의 코드를 작성해줘. 출구는 ${ports.join(', ')} 중 하나를 port로 반환하고${fields.length ? `, data에 ${fields.map((field) => `${field.name}(${field.type}${field.description ? `: ${field.description}` : ''})`).join(', ')} 필드를 채워줘` : ''}. 하는 일: `}>
            AI로 작성
          </AiButton>
        }
        hint="샌드박스: 네트워크·파일 접근 없음, 2초·32MB 제한.">
        <Textarea className="min-h-56 font-mono text-xs leading-relaxed" spellCheck={false} value={params.code as string} onChange={(event) => set('code', event.target.value)} />
      </Field>
      <JsonFieldsEditor label="출력 필드" fields={fields} descriptionPlaceholder="설명" onChange={(next) => set('fields', next)} />
      {!readOnly && (
        <InspectorActionRow
          label="시험 실행"
          description="대표 대사 하나로 코드를 돌려 봅니다."
          action={
            <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              <Play /> 실행
            </Button>
          }
          result={
            test.isPending ? (
              <InspectorResult tone="pending">실행 중</InspectorResult>
            ) : test.data ? (
              <InspectorResult
                tone={test.data.ok && test.data.validPort ? 'ok' : 'error'}
                detail={
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono">
                    {test.data.ok ? JSON.stringify(test.data.result, null, 2) : test.data.error}
                    {'\n\n입력:\n'}
                    {JSON.stringify(test.data.input, null, 2)}
                  </pre>
                }>
                {test.data.ok ? `출구: ${test.data.port}${test.data.validPort ? '' : ' (선언하지 않은 출구!)'} · ${test.data.ms}ms` : '오류'}
              </InspectorResult>
            ) : null
          }
        />
      )}
    </>
  );
}

// ── apply nodes (반영) ────────────────────────────────────────────────

interface SourceField {
  name: string;
  type: JsonFieldType;
  fields?: SourceField[];
}

/** The fields a node's output offers to later nodes. */
function outputFields(node: WorkflowNode): SourceField[] {
  if (node.type === 'function') return ((node.config.params as { fields?: SourceField[] }).fields ?? []);
  if (node.type !== 'ai') return [];
  switch (node.config.output) {
    case 'text':
      return [{ name: 'text', type: 'string' }];
    case 'verdict':
      return [{ name: 'passed', type: 'boolean' }, { name: 'issues', type: 'strings' }];
    case 'choice':
      return [{ name: 'value', type: 'string' }, { name: 'confidence', type: 'number' }, { name: 'reason', type: 'string' }];
    default:
      return node.config.fields;
  }
}

/** Which source types a target field of the given type can take. */
const ACCEPTS: Record<JsonFieldType, JsonFieldType[]> = {
  string: ['string', 'number', 'boolean'],
  number: ['number'],
  boolean: ['boolean'],
  strings: ['strings', 'string'],
  lines: ['lines', 'strings'],
  list: ['list'],
};

function autoMap(targets: ApplyField[], sources: SourceField[]) {
  const map: Record<string, string> = {};
  for (const target of targets) if (sources.some((source) => source.name === target.name && ACCEPTS[target.type].includes(source.type))) map[target.name] = target.name;
  return map;
}

function ApplyConfig({ node, fn, params, refs, setMany }: { node: FunctionNode; fn: ApplyFunctionName; params: ApplyParams; refs: NodeRefs; setMany: (patch: Record<string, unknown>) => void }) {
  const target = APPLY_TARGETS[fn];
  const targetFields: ApplyField[] = target.fields;
  const definition = { nodes: refs.nodes, edges: refs.edges ?? [] } as unknown as WorkflowDefinition;
  // The result applied is the previous step's: the AI or script node this one is drawn after.
  const steps = previousSteps(definition, node.id).filter((step) => step.type !== 'gather');
  const from = steps[0];
  const topFields = [...new Map(steps.flatMap(outputFields).map((field) => [field.name, field])).values()];
  const lists = topFields.filter((field) => field.type === 'list');
  const rowSources = target.shape === 'list' ? (lists.find((field) => field.name === params.list)?.fields ?? []) : topFields;
  const issues = applyIssues(definition, node.id, fn, params);
  const pickList = (list: string) => setMany({ list, map: autoMap(targetFields, lists.find((field) => field.name === list)?.fields ?? []) });
  const setMap = (name: string, source: string) => {
    const { [name]: _dropped, ...rest } = params.map;
    setMany({ map: source === 'none' ? rest : { ...rest, [name]: source } });
  };

  return (
    <>
      <Field label="반영할 결과">
        <StepChips steps={steps} refs={refs} suffix="의 결과" />
      </Field>

      {from && target.shape === 'list' && (
        <Field label="목록 필드" hint={lists.length ? undefined : '이 노드에는 ‘목록’ 필드가 없습니다.'}>
          <Select value={params.list || 'none'} onValueChange={(value) => pickList(value === 'none' ? '' : value)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">고르지 않음</SelectItem>
              {lists.map((field) => (
                <SelectItem key={field.name} value={field.name}>
                  {field.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {from && (target.shape !== 'list' || params.list) && (
        <Field
          label="필드 연결"
          hint="반영할 항목마다 앞 단계 결과의 어느 필드를 쓸지 고릅니다."
          action={
            <Button variant="ghost" size="inline" onClick={() => setMany({ map: { ...autoMap(targetFields, rowSources), ...params.map } })}>
              자동 연결
            </Button>
          }>
          <InspectorList>
            {targetFields.map((field) => {
              const options = rowSources.filter((source) => ACCEPTS[field.type].includes(source.type));
              const value = params.map[field.name];
              return (
                <li key={field.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 text-sm">
                    {field.label}
                    {field.required && <span className="text-destructive"> *<span className="sr-only">필수</span></span>}
                    <span className="block text-xs text-muted-foreground">{JSON_FIELD_TYPE_LABELS[field.type]}</span>
                  </span>
                  <Select value={value ?? 'none'} onValueChange={(next) => setMap(field.name, next)}>
                    <SelectTrigger className="w-full" aria-label={`${field.label} 연결`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">연결 안 함</SelectItem>
                      {value && !options.some((option) => option.name === value) && <SelectItem value={value}>{value} (없어짐)</SelectItem>}
                      {options.map((option) => (
                        <SelectItem key={option.name} value={option.name}>
                          {option.name} · {JSON_FIELD_TYPE_LABELS[option.type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </InspectorList>
        </Field>
      )}

      <Field
        label="반영 방식"
        hint={params.propose ? '사용자가 제안을 수락해야 반영됩니다.' : params.asCandidate ? '바로 쓰지만 후보(✦)로 두어 사람이 확정합니다.' : '바로 반영하고 확정합니다.'}
      >
        <Select
          value={params.propose ? 'propose' : params.asCandidate ? 'candidate' : 'confirmed'}
          onValueChange={(value) => setMany({ propose: value === 'propose', asCandidate: value === 'candidate' })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="propose">제안</SelectItem>
            <SelectItem value="confirmed">바로 확정</SelectItem>
            <SelectItem value="candidate">바로 후보</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {fn === 'saveTermEntry' && (
        <InspectorToggle label="비어 있을 때만 채우기" description="용어에 이미 표기가 있으면 덮어쓰지 않습니다." checked={(params as { onlyEmpty?: boolean }).onlyEmpty !== false} onChange={(value) => setMany({ onlyEmpty: value })} />
      )}

      {issues.map((message) => (
        <InspectorResult key={message} tone="info">
          {message}
        </InspectorResult>
      ))}
    </>
  );
}
