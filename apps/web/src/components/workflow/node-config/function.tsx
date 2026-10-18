/** Config of a function node: the function picked and its parameters (set status, HTTP call, script). */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Plus, Trash2 } from 'lucide-react';
import { APPLY_FUNCTION_NAMES, APPLY_TARGETS, applyIssues, DEFAULT_PARTICLE_PATTERN, formatPatternError, FUNCTIONS, JSON_FIELD_TYPE_LABELS, nodeName, PALETTE_FUNCTION_NAMES, type ApplyField, type ApplyFunctionName, type ApplyParams, type CustomFormatRule, type JsonFieldType, type WorkflowDefinition, type FunctionName, type JsonField, type WorkflowNode } from '@tw/shared';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, StatusIcon, TagChip, GroupHeading } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { AiRegexInput } from '@/components/ai-regex-input';
import { client, unwrap } from '@/lib/api';
import { JsonFieldsEditor } from '@/components/workflow/node-config/json-fields-editor';
import { Field, ToggleRow, type FunctionNode, type NodeRefs } from '@/components/workflow/node-config/shared';

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
  const switchable = fn in APPLY_TARGETS ? APPLY_FUNCTION_NAMES : availableFns;

  const renderBody = () => {
    switch (fn) {
      case 'formatCheck':
        return <FormatCheckConfig params={params} refs={refs} set={set} />;
      case 'glossaryCheck':
        return <p className="text-sm text-muted-foreground">설정 항목이 없습니다.</p>;
      case 'setStatus':
        return <SetStatusConfig params={params} refs={refs} set={set} setMany={setMany} />;
      case 'http':
        return <HttpConfig params={params} refs={refs} set={set} />;
      case 'script':
        return <ScriptConfig params={params} projectId={refs.projectId} readOnly={readOnly} set={set} />;
      default:
        return fn in APPLY_TARGETS ? <ApplyConfig node={node} fn={fn as ApplyFunctionName} params={params as ApplyParams} refs={refs} setMany={setMany} /> : null;
    }
  };

  return (
    <div className="space-y-4">
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
    </div>
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
    <div className="space-y-4">
      <div className="space-y-2.5">
        <ToggleRow label="치환자 보존" checked={params.placeholders as boolean} onChange={(value) => set('placeholders', value)} />
        <ToggleRow label="서식 태그 보존" checked={params.tags as boolean} onChange={(value) => set('tags', value)} />
        <ToggleRow label="줄바꿈 수 일치" checked={params.newlines as boolean} onChange={(value) => set('newlines', value)} />
        <ToggleRow label="빈 번역 금지" checked={params.emptyText as boolean} onChange={(value) => set('emptyText', value)} />
        <ToggleRow label="숫자 누락" checked={Boolean(params.numbers)} onChange={(value) => set('numbers', value)} />
        <ToggleRow label="공백 불일치" checked={Boolean(params.spaces)} onChange={(value) => set('spaces', value)} />
        <ToggleRow label="변수 뒤 조사" checked={Boolean(params.particles)} onChange={(value) => set('particles', value)} />
      </div>

      {Boolean(params.particles) && (
        <Field label="조사 정규식">
          <Input
            className="font-mono text-xs"
            placeholder={DEFAULT_PARTICLE_PATTERN}
            value={(params.particlesPattern as string) ?? ''}
            spellCheck={false}
            onChange={(event) => set('particlesPattern', event.target.value)}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        {LENGTH_LIMITS.map(({ key, label, step }) => (
          <Field key={key} label={label}>
            <Input type="number" min={0} step={step} placeholder="끔" value={(params[key] as number) || ''} onChange={(event) => set(key, Math.max(0, Number(event.target.value) || 0))} />
          </Field>
        ))}
      </div>

      <Field label="금칙어">
        <Input value={(params.forbiddenWords as string) ?? ''} placeholder="예: 암튼, 대충" onChange={(event) => set('forbiddenWords', event.target.value)} />
      </Field>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <GroupHeading>정규식 규칙</GroupHeading>
          <Button type="button" variant="outline" onClick={addRule}>
            <Plus className="size-3.5" /> 규칙 추가
          </Button>
        </div>
        <AiRegexInput
          projectId={refs.projectId}
          target="check"
          onRule={(rule) => {
            if (rule.kind === 'placeholder' || rule.kind === 'tag') return;
            set('customRules', [...customRules, { label: rule.label, kind: rule.kind, pattern: rule.pattern }]);
          }}
        />
        {customRules.length === 0 ? (
          <p className="text-xs text-muted-foreground">규칙이 없습니다.</p>
        ) : (
          <div className="space-y-2.5">
            {customRules.map((rule, index) => {
              const err = rule.pattern.trim() ? formatPatternError(rule.pattern) : '패턴을 입력하세요.';
              return (
                <div key={index} className="space-y-1.5 rounded-md border border-border p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="h-7 flex-1 text-xs"
                      placeholder="예: 영어 잔존 금지"
                      value={rule.label}
                      onChange={(event) => updateRule(index, { label: event.target.value })}
                    />
                    <Select value={rule.kind} onValueChange={(value) => updateRule(index, { kind: value as CustomFormatRule['kind'] })}>
                      <SelectTrigger size="sm" className="w-36 text-xs">
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
                    <Button type="button" size="icon-xs" variant="ghost" className="text-destructive" aria-label="규칙 삭제" onClick={() => removeRule(index)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <Input
                    className="h-7 font-mono text-xs"
                    placeholder="예: [A-Za-z]{4,}"
                    value={rule.pattern}
                    spellCheck={false}
                    onChange={(event) => updateRule(index, { pattern: event.target.value })}
                  />
                  {err && <p className="text-xs text-destructive">{err}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SetStatusConfig({ params, refs, set, setMany }: { params: Record<string, unknown>; refs: NodeRefs; set: (key: string, value: unknown) => void; setMany: (patch: Record<string, unknown>) => void }) {
  const add = params.addTagIds as string[], remove = params.removeTagIds as string[];
  return (
    <>
      <Field label="바꿀 상태">
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
      {refs.statuses.find((status) => status.id === params.statusId)?.humanOnly && <p className="text-xs text-warning">워크플로가 지정하지 않는 상태 → 실행하면 검토함으로 갑니다.</p>}
      {refs.tags.length > 0 && (
        <Field label="태그">
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
      <Field label="API 키" hint={tools.length ? undefined : '등록된 API 키가 없습니다. 워크플로 › API 키에서 추가하세요.'}>
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
      <Field label="응답 경로">
        <Input className="font-mono text-xs" placeholder="result.text" value={params.resultPath as string} onChange={(event) => set('resultPath', event.target.value)} />
      </Field>
      <Field label="결과">
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
      <Field label="제한 시간">
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
      <Field label="출구">
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
      <Field label="출력 필드">
        <JsonFieldsEditor fields={fields} descriptionPlaceholder="설명 (코드를 쓸 때 참고)" onChange={(next) => set('fields', next)} />
      </Field>
      {!readOnly && (
        <div className="space-y-2">
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            <Play /> 시험 실행
          </Button>
          {test.data && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
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

/** Nodes whose output can reach this one: AI and script nodes upstream (any AI/script node when no lines are drawn yet). */
function upstreamSources(node: WorkflowNode, refs: NodeRefs) {
  const edges = refs.edges ?? [];
  const before = new Set<string>();
  const queue = [node.id];
  while (queue.length) {
    const id = queue.pop()!;
    for (const edge of edges) if (edge.target === id && !before.has(edge.source)) { before.add(edge.source); queue.push(edge.source); }
  }
  return refs.nodes.filter((other) => other.id !== node.id && (before.has(other.id) || !edges.length) && (other.type === 'ai' || (other.type === 'function' && other.config.fn === 'script')));
}

function autoMap(targets: ApplyField[], sources: SourceField[]) {
  const map: Record<string, string> = {};
  for (const target of targets) if (sources.some((source) => source.name === target.name && ACCEPTS[target.type].includes(source.type))) map[target.name] = target.name;
  return map;
}

function ApplyConfig({ node, fn, params, refs, setMany }: { node: FunctionNode; fn: ApplyFunctionName; params: ApplyParams; refs: NodeRefs; setMany: (patch: Record<string, unknown>) => void }) {
  const target = APPLY_TARGETS[fn];
  const targetFields: ApplyField[] = target.fields;
  const sources = upstreamSources(node, refs);
  const from = refs.nodes.find((other) => other.id === params.fromNodeId);
  const topFields = from ? outputFields(from) : [];
  const lists = topFields.filter((field) => field.type === 'list');
  const rowSources = target.shape === 'list' ? (lists.find((field) => field.name === params.list)?.fields ?? []) : topFields;
  const definition = { nodes: refs.nodes, edges: refs.edges ?? [] } as unknown as WorkflowDefinition;
  const issues = applyIssues(definition, fn, params);

  const pickFrom = (id: string) => {
    const next = refs.nodes.find((other) => other.id === id);
    const nextTop = next ? outputFields(next) : [];
    const nextLists = nextTop.filter((field) => field.type === 'list');
    const list = target.shape === 'list' ? (nextLists.length === 1 ? nextLists[0]!.name : '') : '';
    const rows = target.shape === 'list' ? (nextLists.find((field) => field.name === list)?.fields ?? []) : nextTop;
    setMany({ fromNodeId: id, list, map: autoMap(targetFields, rows) });
  };
  const pickList = (list: string) => setMany({ list, map: autoMap(targetFields, lists.find((field) => field.name === list)?.fields ?? []) });
  const setMap = (name: string, source: string) => {
    const { [name]: _dropped, ...rest } = params.map;
    setMany({ map: source === 'none' ? rest : { ...rest, [name]: source } });
  };

  return (
    <div className="space-y-4">
      <Field label="결과 노드">
        <Select value={params.fromNodeId || 'none'} onValueChange={(value) => pickFrom(value === 'none' ? '' : value)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">고르지 않음</SelectItem>
            {sources.map((other) => (
              <SelectItem key={other.id} value={other.id}>
                {nodeName(other)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <GroupHeading>필드 연결</GroupHeading>
            <Button variant="outline" onClick={() => setMany({ map: { ...autoMap(targetFields, rowSources), ...params.map } })}>
              자동 연결
            </Button>
          </div>
          <div className="space-y-2">
            {targetFields.map((field) => {
              const options = rowSources.filter((source) => ACCEPTS[field.type].includes(source.type));
              const value = params.map[field.name];
              return (
                <div key={field.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2">
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
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <Field label="반영 방식">
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
      </div>

      {issues.length > 0 && (
        <ul className="space-y-0.5 text-xs text-warning">
          {issues.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
