/** Config of a function node: the function picked and its parameters (set status, HTTP call, script). */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Plus, Trash2 } from 'lucide-react';
import { APPLY_FUNCTION_NAMES, APPLY_TARGETS, ISSUE_KIND_IDS, ISSUE_KINDS, issueKindOf, TAG_ACTIONS, tagLinesParams, fieldsFromSample, httpParams, nodeOutputFields, applyIssues, DEFAULT_PARTICLE_PATTERN, formatPatternError, FUNCTIONS, functionTakes, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, JSON_FIELD_TYPE_LABELS, nodeName, PALETTE_FUNCTION_NAMES, previousSteps, type ApplyField, type ApplyFunctionName, type ApplyParams, type IssueKind, type TagAction, type TagLinesParams, type CustomFormatRule, type JsonFieldType, type WorkflowDefinition, type FunctionName, type JsonField, type WorkflowNode } from '@tw/shared';
import { Button, Input, NumberInput, InspectorActionRow, InspectorFields, InspectorList, InspectorResult, InspectorToggle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, StatusIcon, TagChip } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { AiConfirmNote } from '@/components/settings/ai-confirm';
import { cn } from '@/lib/utils';
import { AiRegexInput } from '@/components/ai-regex-input';
import { client, unwrap } from '@/lib/api';
import { JsonFieldsEditor } from '@/components/workflow/node-config/json-fields-editor';
import { Field, StepChips, ToggleRow, refsInput, type FunctionNode, type NodeRefs } from '@/components/workflow/node-config/shared';

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
  const input = refsInput(refs);
  const switchable = (fn in APPLY_TARGETS ? APPLY_FUNCTION_NAMES : availableFns).filter((name) => name === fn || functionTakes(name, input));

  const renderBody = () => {
    switch (fn) {
      case 'formatCheck':
        return <FormatCheckConfig params={params} refs={refs} set={set} />;
      case 'glossaryCheck':
        return <InspectorResult tone="info">설정 항목이 없습니다.</InspectorResult>;
      case 'setStatus':
        return <SetStatusConfig params={params} refs={refs} set={set} setMany={setMany} />;
      case 'http':
        return <HttpConfig params={params} refs={refs} set={set} />;
      case 'script':
        return <ScriptConfig params={params} projectId={refs.projectId} readOnly={readOnly} set={set} />;
      case 'tagLines':
        return <TagLinesConfig node={node} params={params as TagLinesParams} refs={refs} setMany={setMany} />;
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
            onChange({ ...node, label: keepLabel, config: { ...node.config, fn: nextFn, params: {} } });
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
      {info.async && (
        <Field label="동시 처리 수" hint="1~8개." help="이 노드가 동시에 보내는 호출 수입니다. 늘리면 빨라지지만, 받는 쪽이 요청 한도에 걸리기 쉽습니다.">
          <NumberInput min={1} max={8} className="w-28" value={node.config.concurrency} onValueChange={(concurrency) => concurrency !== undefined && onChange({ ...node, config: { ...node.config, concurrency } })} />
        </Field>
      )}
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
      <InspectorToggle label="치환자 보존" help="원문의 {이름} 같은 치환자가 번역에 그대로 있어야 합니다." checked={params.placeholders as boolean} onChange={(value) => set('placeholders', value)} />
      <InspectorToggle label="서식 태그 보존" help="원문의 서식 태그가 번역에 그대로 있어야 합니다." checked={params.tags as boolean} onChange={(value) => set('tags', value)} />
      <InspectorToggle label="줄바꿈 수 일치" help="원문과 번역의 줄바꿈 수가 같아야 합니다." checked={params.newlines as boolean} onChange={(value) => set('newlines', value)} />
      <InspectorToggle label="빈 번역 금지" help="번역이 비어 있으면 통과하지 못합니다." checked={params.emptyText as boolean} onChange={(value) => set('emptyText', value)} />
      <InspectorToggle label="숫자 누락" help="원문의 숫자가 번역에 빠졌는지 봅니다." checked={Boolean(params.numbers)} onChange={(value) => set('numbers', value)} />
      <InspectorToggle label="공백 불일치" help="앞뒤 공백이 원문과 다른지 봅니다." checked={Boolean(params.spaces)} onChange={(value) => set('spaces', value)} />
      <InspectorToggle label="변수 뒤 조사" help="치환자 바로 뒤의 조사(이/가, 을/를 등)가 맞는지 봅니다." checked={Boolean(params.particles)} onChange={(value) => set('particles', value)} />

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
          <NumberInput min={0} step={step} integer={step >= 1} optional placeholder="끔" value={(params[key] as number) || undefined} onValueChange={(next) => set(key, next ?? 0)} />
        </Field>
      ))}

      <Field label="금칙어" hint="쉼표로 구분합니다." help="번역에 이 말이 들어 있으면 검사에 걸립니다.">
        <Input value={(params.forbiddenWords as string) ?? ''} placeholder="예: 암튼, 대충" onChange={(event) => set('forbiddenWords', event.target.value)} />
      </Field>

      <Field label="정규식 규칙" help="금지: 번역에 나오면 안 되는 패턴 · 보존: 원문에 있으면 번역에도 있어야 하는 패턴 · 필수: 번역에 꼭 있어야 하는 패턴">
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
            {refsInput(refs) === 'terms'
              ? KNOWLEDGE_STATUSES.map((status) => <SelectItem key={status} value={status}>{KNOWLEDGE_STATUS_LABELS[status]}</SelectItem>)
              : refs.statuses.map((status) => (
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


/**
 * 태그 붙이기 / 떼기: what to do, which tags (picked here and/or named by a field of the previous step's
 * result), and for 떼기 every 문제 유형. Checks and reviews only judge; this node is where tags change.
 */
function TagLinesConfig({ node, params, refs, setMany }: { node: FunctionNode; params: TagLinesParams; refs: NodeRefs; setMany: (patch: Record<string, unknown>) => void }) {
  const add = params.action === 'add';
  const terms = refsInput(refs) === 'terms';
  const definition = { nodes: refs.nodes, edges: refs.edges ?? [] } as unknown as WorkflowDefinition;
  const steps = previousSteps(definition, node.id).filter((step) => step.type !== 'gather');
  // Fields that can hold tag names: texts and lists of texts.
  const fields = [...new Map(steps.flatMap((step) => nodeOutputFields(step) ?? []).filter((field) => field.type === 'string' || field.type === 'strings').map((field) => [field.name, field])).values()];
  const from = params.map.tag;
  const own = refs.tags.filter((tag) => !issueKindOf(tag.name));
  const toggle = (key: 'tagIds' | 'kinds', id: string) => {
    const list = params[key] as string[];
    setMany({ [key]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id] });
  };
  const chip = (on: boolean, label: string, color: string, onClick: () => void) => (
    <Button key={label} variant="ghost" size="inline" className="h-auto p-0 hover:bg-transparent" aria-pressed={on} onClick={onClick}>
      {on && <span className="text-xs text-muted-foreground">{add ? '+' : '−'}</span>}
      <TagChip tag={{ name: label, color }} className={cn(!on && 'opacity-50 hover:opacity-100', on && !add && 'line-through')} />
    </Button>
  );
  const issues = applyIssues(definition, node.id, 'tagLines', params);

  return (
    <>
      <Field label="동작">
        <Select value={params.action} onValueChange={(action) => setMany({ action, ...(action === 'add' && { allKinds: false }) })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TAG_ACTIONS) as TagAction[]).map((action) => (
              <SelectItem key={action} value={action}>
                {TAG_ACTIONS[action]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="고른 태그" hint={`누르면 ${add ? '붙일' : '뗄'} 태그에 넣고, 한 번 더 누르면 뺍니다.`}>
        <div className="flex flex-wrap gap-1.5">
          {!terms &&
            ISSUE_KIND_IDS.map((kind: IssueKind) => chip(params.kinds.includes(kind) || (!add && params.allKinds), ISSUE_KINDS[kind].name, ISSUE_KINDS[kind].color, () => !params.allKinds && toggle('kinds', kind)))}
          {own.map((tag) => chip(params.tagIds.includes(tag.id), tag.name, tag.color, () => toggle('tagIds', tag.id)))}
        </div>
        {!terms && !add && <ToggleRow label="모든 문제 유형" help="검사·검수가 남긴 문제 유형 태그를 모두 뗍니다. 사람이 만든 태그는 그대로 둡니다." checked={params.allKinds} onChange={(allKinds) => setMany({ allKinds, ...(allKinds && { kinds: [] }) })} />}
      </Field>

      <Field
        label="앞 단계 결과의 종류"
        hint={steps.length ? '고르면 그 필드의 값이 태그 이름입니다. 문제 유형은 이름이나 영문 id(speech)로 씁니다.' : undefined}
        help="AI 검수의 categories, 검사의 kind처럼 앞 단계가 알려준 문제 유형으로 태그를 정합니다. 고른 태그와 함께 쓸 수 있습니다."
      >
        {steps.length ? (
          <>
            <StepChips steps={steps} refs={refs} suffix="의 결과" />
            <Select value={from ?? 'none'} onValueChange={(next) => setMany({ map: next === 'none' ? {} : { tag: next } })}>
              <SelectTrigger className="w-full" aria-label="태그 이름 필드">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">쓰지 않음</SelectItem>
                {from && !fields.some((field) => field.name === from) && <SelectItem value={from}>{from} (없어짐)</SelectItem>}
                {fields.map((field) => (
                  <SelectItem key={field.name} value={field.name}>
                    {field.name} · {JSON_FIELD_TYPE_LABELS[field.type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">앞 단계에 결과를 내는 노드(AI·검사·스크립트)가 없습니다.</p>
        )}
      </Field>

      {issues.map((message) => (
        <InspectorResult key={message} tone="info">
          {message}
        </InspectorResult>
      ))}
    </>
  );
}

const PLACEHOLDERS = '{{candidate}}, {{unit.source}}, {{unit.speaker}}, {{unit.key}}, {{previous.<필드>}}, {{outputs.<노드ID>.<필드>}}';

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
      <Field label="주소" help="대사마다 바뀌는 값을 주소에 넣을 수도 있습니다.">
        <Input className="font-mono text-xs" value={params.url as string} placeholder="https://api.example.com/spell" onChange={(event) => set('url', event.target.value)} />
      </Field>
      <Field label="API 키" help={tools.length ? '요청에 붙일 인증 정보입니다.' : undefined} hint={tools.length ? undefined : '등록된 API 키가 없습니다. 워크플로 › API 키에서 추가하세요.'}>
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
      <HttpFields params={params} projectId={refs.projectId} set={set} />
      <Field label="제한 시간" hint="초 단위, 1–300.">
        <NumberInput min={1} max={300} value={params.timeoutSeconds as number} onValueChange={(next) => next !== undefined && set('timeoutSeconds', next)} />
      </Field>
    </>
  );
}

/**
 * What an HTTP call returns: declared fields (like a script's), each read from the response at its path
 * (default: its own name). A test call shows the response and can fill the fields from it.
 */
function HttpFields({ params, projectId, set }: { params: Record<string, unknown>; projectId: string; set: (key: string, value: unknown) => void }) {
  const fields = (params.fields as JsonField[] | undefined) ?? [];
  const paths = (params.paths as Record<string, string> | undefined) ?? {};
  const test = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['http-test'].$post({ param: { projectId }, json: { params: httpParams.parse(params) } })),
  });
  const sampled = test.data?.ok ? fieldsFromSample(test.data.raw) : [];
  return (
    <>
      <JsonFieldsEditor label="결과 칸" fields={fields} descriptionPlaceholder="설명" onChange={(next) => set('fields', next)} />
      {fields.length > 0 && (
        <Field label="응답에서 가져올 곳" hint="비우면 칸 이름과 같은 키를 씁니다. 예: result.text">
          <div className="space-y-1.5">
            {fields.map((field) => (
              <div key={field.name} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate font-mono">{field.name}</span>
                <Input className="font-mono text-xs" placeholder={field.name} value={paths[field.name] ?? ''} onChange={(event) => set('paths', { ...paths, [field.name]: event.target.value })} />
              </div>
            ))}
          </div>
        </Field>
      )}
      <InspectorActionRow
        label="시험 호출"
        description="첫 대사로 주소를 한 번 호출해 봅니다."
        action={<Button variant="outline" disabled={test.isPending || !(params.url as string)?.trim()} onClick={() => test.mutate()}><Play /> 호출</Button>}
        result={
          test.isPending ? <InspectorResult tone="pending">호출 중</InspectorResult> : test.data ? (
            <InspectorResult
              tone={test.data.ok ? 'ok' : 'error'}
              detail={<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono">{test.data.ok ? JSON.stringify(test.data.raw, null, 2) : test.data.error}</pre>}>
              {test.data.ok ? (
                <span className="flex items-center gap-2">
                  {test.data.ms}ms
                  {sampled.length > 0 && <Button size="sm" variant="ghost" onClick={() => set('fields', sampled)}>이 결과로 칸 채우기</Button>}
                </span>
              ) : '오류'}
            </InspectorResult>
          ) : null
        }
      />
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
  const sampledScript = test.data?.ok ? fieldsFromSample(test.data.raw) : [];
  return (
    <>
      <Field label="출구" hint="쉼표로 구분합니다." help="코드가 이 중 하나를 port로 반환하면 그 출구로 나갑니다.">
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
        help="격리된 곳에서 돌아갑니다. 네트워크·파일에 접근할 수 없고, 한 번에 2초·32MB까지 씁니다.">
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
                {test.data.ok ? (
                  <span className="flex items-center gap-2">
                    {`출구: ${test.data.port}${test.data.validPort ? '' : ' (선언하지 않은 출구!)'} · ${test.data.ms}ms`}
                    {sampledScript.length > 0 && <Button size="sm" variant="ghost" onClick={() => set('fields', sampledScript)}>이 결과로 칸 채우기</Button>}
                  </span>
                ) : '오류'}
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

/** The fields a node's output offers to later nodes: what it declares (nodeOutputFields). */
const outputFields = (node: WorkflowNode): SourceField[] => nodeOutputFields(node) ?? [];

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
          help="반영할 항목마다 앞 단계 결과의 어느 필드를 쓸지 고릅니다."
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

      {(target.shape !== 'line' || (fn === 'saveCandidate' && refsInput(refs) === 'terms')) && <AiConfirmNote projectId={refs.projectId} />}


      {issues.map((message) => (
        <InspectorResult key={message} tone="info">
          {message}
        </InspectorResult>
      ))}
    </>
  );
}
