/** Config of a function node: the function picked and its parameters (set status, HTTP call, script). */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Play, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_PARTICLE_PATTERN, formatPatternError, FUNCTIONS, nodeName, PALETTE_FUNCTION_NAMES, type CustomFormatRule, type FunctionName, type WorkflowNode } from '@tw/shared';
import { AiConfirmNote } from '@/components/settings/ai-confirm';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, StatusIcon, TagChip } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { client, unwrap } from '@/lib/api';
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

  const renderBody = () => {
    switch (fn) {
      case 'formatCheck':
        return <FormatCheckConfig params={params} refs={refs} set={set} />;
      case 'glossaryCheck':
        return <p className="text-sm text-muted-foreground">별도의 설정 항목이 없습니다. 실패 사유는 다음 AI 노드의 지적 사항으로 전달됩니다.</p>;
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
    case 'saveAnalysis': {
      const sources = refs.nodes.filter((other) => other.type === 'ai' && other.config.output === 'analysis');
      return (
        <>
          <Field label="분석을 가져올 AI 노드" hint="사람이 만들거나 고치거나 확정·버린 항목은 그대로 둡니다. 근거 줄이 대본에 없으면 빼고 셉니다.">
            <Select value={(params.fromNodeId as string) || 'latest'} onValueChange={(value) => set('fromNodeId', value === 'latest' ? '' : value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">가장 최근 작품 분석 출력</SelectItem>
                {sources.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {nodeName(other)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <AiConfirmNote projectId={refs.projectId} kinds={['documents', 'characters', 'relationships', 'events', 'speechRules', 'terms']} />
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
  };

  return (
    <div className="space-y-4">
      <Field label="함수 동작 종류">
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
            {availableFns.map((name) => (
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
  forbidden: '번역문 금지 패턴',
  preserve: '원문→번역 보존',
  targetRequired: '번역문 필수 패턴',
};

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
      <p className="text-xs text-muted-foreground">
        무엇을 치환자·태그로 인식할지는{' '}
        <Link to="/p/$projectId/settings/editor" params={{ projectId: refs.projectId }} className="text-primary underline">
          프로젝트 설정 › 치환자·태그 문법
        </Link>
        에서 관리합니다.
      </p>

      <div className="space-y-2.5">
        <ToggleRow label="치환자 보존 ({name}, %s 등)" checked={params.placeholders as boolean} onChange={(value) => set('placeholders', value)} />
        <ToggleRow label="서식 태그 보존 (<b> 등)" checked={params.tags as boolean} onChange={(value) => set('tags', value)} />
        <ToggleRow label="줄바꿈 수 일치" checked={params.newlines as boolean} onChange={(value) => set('newlines', value)} />
        <ToggleRow label="빈 번역 금지" checked={params.emptyText as boolean} onChange={(value) => set('emptyText', value)} />
        <ToggleRow label="원문 숫자 누락 검사 (2038, 08:29 등)" checked={Boolean(params.numbers)} onChange={(value) => set('numbers', value)} />
        <ToggleRow label="공백 오류 검사 (이중·앞뒤 공백 불일치)" checked={Boolean(params.spaces)} onChange={(value) => set('spaces', value)} />
        <ToggleRow label="한국어 변수 뒤 조사 검사 ({name}을 등)" checked={Boolean(params.particles)} onChange={(value) => set('particles', value)} />
      </div>

      {Boolean(params.particles) && (
        <Field label="조사 판별 정규식" hint="비워 두면 기본 한국어 조사 패턴(을/를/이/가/은/는/와/과 등)을 사용합니다.">
          <Input
            className="font-mono text-xs"
            placeholder={DEFAULT_PARTICLE_PATTERN}
            value={(params.particlesPattern as string) ?? ''}
            spellCheck={false}
            onChange={(event) => set('particlesPattern', event.target.value)}
          />
        </Field>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">사용자 정의 검사 규칙 (정규식)</p>
          <Button type="button" variant="outline" onClick={addRule}>
            <Plus className="size-3.5" /> 규칙 추가
          </Button>
        </div>
        {customRules.length === 0 ? (
          <p className="text-xs text-muted-foreground">추가된 사용자 정의 정규식 규칙이 없습니다.</p>
        ) : (
          <div className="space-y-2.5">
            {customRules.map((rule, index) => {
              const err = rule.pattern.trim() ? formatPatternError(rule.pattern) : '패턴을 입력하세요.';
              return (
                <div key={index} className="space-y-1.5 rounded-md border border-border p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="h-7 flex-1 text-xs"
                      placeholder="규칙 이름 (예: 영어 잔존 금지)"
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
                    placeholder="정규식 패턴 (예: [A-Za-z]{4,})"
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
      <Field label="상태를 바꾸기">
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
      {refs.statuses.find((status) => status.id === params.statusId)?.humanOnly && <p className="text-xs text-warning">사람만 지정 상태 → 실행하면 검토함으로 갑니다.</p>}
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
        <Field label="주소" help="주소에도 {{unit.key}} 같은 값을 넣을 수 있습니다(자동으로 URL 인코딩).">
          <Input className="font-mono text-xs" value={params.url as string} placeholder="https://api.example.com/spell" onChange={(event) => set('url', event.target.value)} />
        </Field>
      </div>
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
