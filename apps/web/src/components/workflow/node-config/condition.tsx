/** Config of a condition node: the condition as rows, anything rows cannot say as JSON Logic. */
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { type AutoMark, CONDITION_MARK_IDS, INPUT_TYPES, ITEM_ERROR_KIND_IDS, ITEM_ERROR_KINDS, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, nodeName, type WorkflowNode } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { type StyleProps, Box, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, NumberInput, Inline, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusIcon, Switch, TagChip, Text, Textarea, Field } from '@loca/ui';
import { comparableFields, conditionExpression, parseCondition, type Clause, type Condition, type FieldOperator, type Join } from '@/components/workflow/node-config/condition-clauses';
import { AiButton } from '@/components/ai-button';
import { refsInput, type ConditionNode, type NodeRefs } from '@/components/workflow/node-config/shared';

// ── condition node ────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  dialogue: '대사',
  ui: 'UI 문자열',
  document: '문서·교재',
};

const FIELD_OPERATORS: Record<FieldOperator, string> = { '>=': '≥', '<=': '≤', '==': '=', '!=': '≠', filled: '비어 있지 않음' };
/** Rows a condition can add: the core ones and, from INPUT_TYPES, those of the workflow's input. */
const ADDABLE = { status: '상태', final: '최종 상태', decidedBy: '정한 쪽', lineKind: '종류', tag: '태그', mark: '자동 태그', listener: '청자', listenerUnknown: '청자 모름', noted: '메모', speechRule: '말투 규칙', speechMatch: '선택 = 말투 규칙', termStatus: '용어 상태', hasTarget: '표기', uses: '쓰인 대사 수', candidate: '번역문', field: '노드 결과', visits: '방문 횟수', error: '실패 종류' } as const;
type Addable = keyof typeof ADDABLE;
const INPUT_ROWS = new Set<string>([...INPUT_TYPES.lines.conditionRows, ...INPUT_TYPES.terms.conditionRows]);


function Pick({ value, onChange, label, width, mono, children }: { value: string; onChange: (value: string) => void; label: string; width: NonNullable<StyleProps['width']>; mono?: boolean; children: React.ReactNode }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <Box asChild minWidth={0} width={width} mono={mono}><SelectTrigger size="sm" aria-label={label}><SelectValue /></SelectTrigger></Box>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

/** = / ≠ between a property and its value, or 있음/없음 after one. */
function Negate({ not, words, onChange }: { not?: boolean; words: [string, string]; onChange: (not: boolean) => void }) {
  return (
    <Pick label="조건 방향" value={not ? 'not' : 'is'} onChange={(value) => onChange(value === 'not')} width={words[0] === '=' ? 'field-xs' : 'field-sm'}>
      <SelectItem value="is">{words[0]}</SelectItem>
      <SelectItem value="not">{words[1]}</SelectItem>
    </Pick>
  );
}

/** The condition as rows (상태가 … · 노드 결과 ≥ …), joined by 모두/하나라도; JSON behind a switch, and always for what rows cannot say. */
export function ConditionEditor({ node, nodes, refs, readOnly, onChange }: { node: ConditionNode; nodes: WorkflowNode[]; refs?: NodeRefs; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
  const [text, setText] = useState(() => JSON.stringify(node.config.expression ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [asJson, setAsJson] = useState(false);
  useEffect(() => {
    setText(JSON.stringify(node.config.expression ?? null, null, 2));
    setError(null);
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseCondition(node.config.expression);
  const json = asJson || !parsed;
  const statuses = refs?.statuses ?? [];
  const tags = refs?.tags ?? [];
  const others = nodes.filter((other) => other.id !== node.id && other.type !== 'entry' && other.type !== 'end');
  const outputs = others.map((other) => ({ node: other, fields: comparableFields(other) })).filter((entry) => entry.fields.length > 0);
  const fieldsOf = (id: string) => outputs.find((entry) => entry.node.id === id)?.fields ?? [];
  // AI nodes that pick one option: their choice can be compared with the line's speech rule.
  const choosers = others.filter((other) => other.type === 'ai' && other.config.output === 'choice');

  const write = (condition: Condition) => {
    const expression = conditionExpression(condition);
    setText(JSON.stringify(expression, null, 2));
    setError(null);
    onChange({ ...node, config: { ...node.config, expression } });
  };
  const condition = parsed ?? { join: 'and' as Join, clauses: [] };
  const setClause = (index: number, clause: Clause) => write({ ...condition, clauses: condition.clauses.map((item, i) => (i === index ? clause : item)) });
  const removeClause = (index: number) => write({ ...condition, clauses: condition.clauses.filter((_, i) => i !== index) });
  const fresh = (kind: Addable): Clause | null => {
    switch (kind) {
      case 'status': return statuses[0] ? { kind, statusId: statuses[0].id } : null;
      case 'lineKind': return { kind, value: 'dialogue' };
      case 'tag': return tags[0] ? { kind, tagId: tags[0].id } : null;
      case 'mark': return { kind, mark: CONDITION_MARK_IDS[0] };
      case 'visits': return others[0] ? { kind, nodeId: others[0].id, limit: 3 } : null;
      case 'field': {
        const first = outputs[0];
        if (!first) return null;
        const field = first.fields[0]!;
        return { kind, nodeId: first.node.id, field: field.name, op: field.type === 'boolean' ? '==' : field.type === 'number' ? '>=' : 'filled', value: field.type === 'boolean' ? true : field.type === 'number' ? 0.7 : '' };
      }
      case 'listener': return { kind };
      case 'final': return { kind, not: true };
      case 'decidedBy': return { kind, by: 'ai' };
      case 'listenerUnknown': return { kind };
      case 'noted': return { kind };
      case 'speechRule': return { kind };
      case 'speechMatch': return choosers[0] ? { kind, nodeId: choosers[0].id } : null;
      case 'candidate': return { kind };
      case 'error': return { kind, errorKind: 'missing' };
      case 'termStatus': return { kind, status: 'candidate' };
      case 'hasTarget': return { kind };
      case 'uses': return { kind, op: '>=', value: 3 };
    }
  };
  const inputRows = new Set<string>(INPUT_TYPES[refs ? refsInput(refs) : 'lines'].conditionRows);
  const addable = (Object.keys(ADDABLE) as Addable[]).filter((kind) => (!INPUT_ROWS.has(kind) || inputRows.has(kind)) && fresh(kind));

  const row = (clause: Clause, index: number) => {
    const set = (next: Clause) => setClause(index, next);
    switch (clause.kind) {
      case 'status':
        return <>상태 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="상태" value={clause.statusId} onChange={(statusId) => set({ ...clause, statusId })} width="field">{statuses.map((st) => <SelectItem key={st.id} value={st.id}><StatusIcon status={st} /> {st.name}</SelectItem>)}</Pick></>;
      case 'lineKind':
        return <>종류 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="종류" value={clause.value} onChange={(value) => set({ ...clause, value })} width="field">{Object.entries(KIND_LABELS).map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</Pick></>;
      case 'tag':
        return <>태그 <Pick label="태그" value={clause.tagId} onChange={(tagId) => set({ ...clause, tagId })} width="field">{tags.map((tg) => <SelectItem key={tg.id} value={tg.id}><TagChip tag={tg} /></SelectItem>)}</Pick> <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'mark':
        return <>자동 태그 <Pick label="자동 태그" value={clause.mark} onChange={(mark) => set({ ...clause, mark })} width="field-lg">{CONDITION_MARK_IDS.map((id) => <SelectItem key={id} value={id}><MarkChip mark={id as AutoMark} /></SelectItem>)}</Pick> <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'visits':
        return <><Pick label="노드" value={clause.nodeId} onChange={(nodeId) => set({ ...clause, nodeId })} width="field">{others.map((other) => <SelectItem key={other.id} value={other.id}>{nodeName(other)}</SelectItem>)}</Pick> 방문 <Box asChild height="control" width="field-xs"><NumberInput min={1} aria-label="방문 횟수" value={clause.limit} onValueChange={(limit) => limit !== undefined && set({ ...clause, limit })} /></Box> 회 미만</>;
      case 'field': {
        const fields = fieldsOf(clause.nodeId);
        const field = fields.find((item) => item.name === clause.field);
        const type = field?.type ?? 'string';
        const pickField = (name: string) => {
          const next = fields.find((item) => item.name === name);
          const nextType = next?.type ?? 'string';
          set({ ...clause, field: name, op: nextType === 'boolean' ? '==' : nextType === 'number' ? '>=' : 'filled', value: nextType === 'boolean' ? true : nextType === 'number' ? 0.7 : '' });
        };
        const ops = (Object.keys(FIELD_OPERATORS) as FieldOperator[]).filter((item) => (type === 'number' ? item !== 'filled' : type === 'boolean' ? item === '==' : item === '==' || item === '!=' || item === 'filled'));
        return (
          <>
            <Pick label="노드" value={clause.nodeId} onChange={(nodeId) => { const first = fieldsOf(nodeId)[0]; set({ ...clause, nodeId, field: first?.name ?? '' }); }} width="field">{outputs.map((entry) => <SelectItem key={entry.node.id} value={entry.node.id}>{nodeName(entry.node)}</SelectItem>)}</Pick>
            <Pick label="필드" value={clause.field} onChange={pickField} width="field" mono>{fields.map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</Pick>
            {type === 'boolean' ? (
              <Pick label="값" value={clause.value === false ? 'false' : 'true'} onChange={(value) => set({ ...clause, op: '==', value: value === 'true' })} width="field-sm"><SelectItem value="true">참</SelectItem><SelectItem value="false">거짓</SelectItem></Pick>
            ) : (
              <>
                <Pick label="비교" value={clause.op} onChange={(value) => set({ ...clause, op: value as FieldOperator })} width={clause.op === 'filled' ? 'field' : 'field-xs'}>{ops.map((item) => <SelectItem key={item} value={item}>{FIELD_OPERATORS[item]}</SelectItem>)}</Pick>
                {clause.op !== 'filled' && <Box asChild height="control" width="field-sm"><Input type={type === 'number' ? 'number' : 'text'} step={type === 'number' ? 0.05 : undefined} aria-label="비교할 값" value={String(clause.value)} onChange={(event) => set({ ...clause, value: type === 'number' ? Number(event.target.value) : event.target.value })} /></Box>}
              </>
            )}
          </>
        );
      }
      case 'error':
        return <>실패 종류 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="실패 종류" value={clause.errorKind} onChange={(errorKind) => set({ ...clause, errorKind: errorKind as typeof clause.errorKind })} width="field">{ITEM_ERROR_KIND_IDS.map((id) => <SelectItem key={id} value={id}>{ITEM_ERROR_KINDS[id]}</SelectItem>)}</Pick></>;
      case 'termStatus':
        return <>용어 상태 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="용어 상태" value={clause.status} onChange={(status) => set({ ...clause, status })} width="field">{KNOWLEDGE_STATUSES.map((status) => <SelectItem key={status} value={status}>{KNOWLEDGE_STATUS_LABELS[status]}</SelectItem>)}</Pick></>;
      case 'hasTarget':
        return <>표기 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'uses':
        return <>쓰인 대사 <Pick label="비교" value={clause.op} onChange={(value) => set({ ...clause, op: value as '>=' | '<=' })} width="field-xs"><SelectItem value=">=">≥</SelectItem><SelectItem value="<=">≤</SelectItem></Pick> <Box asChild height="control" width="field-sm"><NumberInput min={0} aria-label="쓰인 대사 수" value={clause.value} onValueChange={(value) => value !== undefined && set({ ...clause, value })} /></Box> 줄</>;
      case 'listener':
        return <>청자 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'final':
        return <>상태가 <Negate not={clause.not} words={['최종', '최종 아님']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'decidedBy':
        return <>상태를 정한 쪽 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="정한 쪽" value={clause.by} onChange={(by) => set({ ...clause, by: by as 'ai' | 'human' })} width="field-sm"><SelectItem value="ai">AI (✦)</SelectItem><SelectItem value="human">사람</SelectItem></Pick></>;
      case 'listenerUnknown':
        return <>청자 모름 <Negate not={clause.not} words={['맞음', '아님']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'noted':
        return <>메모 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'speechRule':
        return <>화자 → 청자 말투 규칙 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'speechMatch':
        return <><Pick label="선택 노드" value={clause.nodeId} onChange={(nodeId) => set({ ...clause, nodeId })} width="field">{choosers.map((other) => <SelectItem key={other.id} value={other.id}>{nodeName(other)}</SelectItem>)}</Pick> 의 선택 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> 말투 규칙</>;
      case 'candidate':
        return <>번역문 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
    }
  };

  return (
    <Box spaceY="normal">
      <Field
        label="설명"
        action={
          !readOnly && (
            <AiButton variant="ghost" send={false} prompt="이 조건 노드의 조건을 이렇게 바꿔줘: ">
              AI로 쓰기
            </AiButton>
          )
        }
      >
        <Input value={node.config.description} onChange={(event) => onChange({ ...node, config: { ...node.config, description: event.target.value } })} />
      </Field>
      <Field
        label="조건"
        action={
          <Inline shrink={false} gap="condensed">
            {!json && condition.clauses.length > 1 && (
              <Pick label="묶는 방식" value={condition.join} onChange={(join) => write({ ...condition, join: join as Join })} width="field">
                <SelectItem value="and">모두 만족</SelectItem>
                <SelectItem value="or">하나라도 만족</SelectItem>
              </Pick>
            )}
            <Inline as="label" gap="tight" variant="caption" tone="muted">
              JSON
              <Switch checked={json} disabled={!parsed} onCheckedChange={setAsJson} />
            </Inline>
          </Inline>
        }
      >
        {json ? (
          <Box spaceY="tight">
            <Box asChild minHeight="textarea" mono variant="caption">
              <Textarea
                value={text}
                spellCheck={false}
                readOnly={readOnly}
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
            </Box>
            {error && <Text as="p" variant="caption" tone="danger">{error}</Text>}
          </Box>
        ) : (
          <Box spaceY="condensed">
            {condition.clauses.map((clause, index) => (
              <Inline key={index} minWidth={0} gap="condensed" variant="body">
                <Inline minWidth={0} grow wrap gap="condensed">{row(clause, index)}</Inline>
                {!readOnly && (
                  <Button size="icon-sm" variant="ghost" shrink={false} tone="muted" aria-label="조건 빼기" onClick={() => removeClause(index)}>
                    <X />
                  </Button>
                )}
              </Inline>
            ))}
            {!readOnly && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" flush="start" tone="muted"><Plus /> 조건</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {addable.map((kind) => (
                    <DropdownMenuItem key={kind} onClick={() => write({ ...condition, clauses: [...condition.clauses, fresh(kind)!] })}>{ADDABLE[kind]}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </Box>
        )}
      </Field>
    </Box>
  );
}
