/** Config of a condition node: the condition as rows, anything rows cannot say as JSON Logic. */
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { type AutoMark, CONDITION_MARK_IDS, INPUT_TYPES, ITEM_ERROR_KIND_IDS, ITEM_ERROR_KINDS, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, nodeName, type WorkflowNode } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, NumberInput, InspectorFields, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusIcon, Switch, TagChip, Textarea } from '@loca/ui';
import { comparableFields, conditionExpression, parseCondition, type Clause, type Condition, type FieldOperator, type Join } from '@/components/workflow/node-config/condition-clauses';
import { AiButton } from '@/components/ai-button';
import { Field, refsInput, type ConditionNode, type NodeRefs } from '@/components/workflow/node-config/shared';

// ── condition node ────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  dialogue: '대사',
  ui: 'UI 문자열',
  document: '문서·교재',
};

const FIELD_OPERATORS: Record<FieldOperator, string> = { '>=': '≥', '<=': '≤', '==': '=', '!=': '≠', filled: '비어 있지 않음' };
/** Rows a condition can add: the core ones and, from INPUT_TYPES, those of the workflow's input. */
const ADDABLE = { status: '상태', lineKind: '종류', tag: '태그', mark: '자동 태그', listener: '청자', termStatus: '용어 상태', hasTarget: '표기', uses: '쓰인 대사 수', candidate: '번역문', field: '노드 결과', visits: '방문 횟수', error: '실패 종류' } as const;
type Addable = keyof typeof ADDABLE;
const INPUT_ROWS = new Set<string>([...INPUT_TYPES.lines.conditionRows, ...INPUT_TYPES.terms.conditionRows]);


function Pick({ value, onChange, label, className, children }: { value: string; onChange: (value: string) => void; label: string; className?: string; children: React.ReactNode }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn('min-w-0', className)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

/** = / ≠ between a property and its value, or 있음/없음 after one. */
function Negate({ not, words, onChange }: { not?: boolean; words: [string, string]; onChange: (not: boolean) => void }) {
  return (
    <Pick label="조건 방향" value={not ? 'not' : 'is'} onChange={(value) => onChange(value === 'not')} className={words[0] === '=' ? 'w-16' : 'w-20'}>
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
        return <>상태 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="상태" value={clause.statusId} onChange={(statusId) => set({ ...clause, statusId })} className="w-36">{statuses.map((st) => <SelectItem key={st.id} value={st.id}><StatusIcon status={st} /> {st.name}</SelectItem>)}</Pick></>;
      case 'lineKind':
        return <>종류 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="종류" value={clause.value} onChange={(value) => set({ ...clause, value })} className="w-32">{Object.entries(KIND_LABELS).map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</Pick></>;
      case 'tag':
        return <>태그 <Pick label="태그" value={clause.tagId} onChange={(tagId) => set({ ...clause, tagId })} className="w-36">{tags.map((tg) => <SelectItem key={tg.id} value={tg.id}><TagChip tag={tg} /></SelectItem>)}</Pick> <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'mark':
        return <>자동 태그 <Pick label="자동 태그" value={clause.mark} onChange={(mark) => set({ ...clause, mark })} className="w-40">{CONDITION_MARK_IDS.map((id) => <SelectItem key={id} value={id}><MarkChip mark={id as AutoMark} /></SelectItem>)}</Pick> <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'visits':
        return <><Pick label="노드" value={clause.nodeId} onChange={(nodeId) => set({ ...clause, nodeId })} className="w-36">{others.map((other) => <SelectItem key={other.id} value={other.id}>{nodeName(other)}</SelectItem>)}</Pick> 방문 <NumberInput min={1} className="h-8 w-14" aria-label="방문 횟수" value={clause.limit} onValueChange={(limit) => limit !== undefined && set({ ...clause, limit })} /> 회 미만</>;
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
            <Pick label="노드" value={clause.nodeId} onChange={(nodeId) => { const first = fieldsOf(nodeId)[0]; set({ ...clause, nodeId, field: first?.name ?? '' }); }} className="w-36">{outputs.map((entry) => <SelectItem key={entry.node.id} value={entry.node.id}>{nodeName(entry.node)}</SelectItem>)}</Pick>
            <Pick label="필드" value={clause.field} onChange={pickField} className="w-32 font-mono">{fields.map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</Pick>
            {type === 'boolean' ? (
              <Pick label="값" value={clause.value === false ? 'false' : 'true'} onChange={(value) => set({ ...clause, op: '==', value: value === 'true' })} className="w-20"><SelectItem value="true">참</SelectItem><SelectItem value="false">거짓</SelectItem></Pick>
            ) : (
              <>
                <Pick label="비교" value={clause.op} onChange={(value) => set({ ...clause, op: value as FieldOperator })} className={clause.op === 'filled' ? 'w-36' : 'w-16'}>{ops.map((item) => <SelectItem key={item} value={item}>{FIELD_OPERATORS[item]}</SelectItem>)}</Pick>
                {clause.op !== 'filled' && <Input type={type === 'number' ? 'number' : 'text'} step={type === 'number' ? 0.05 : undefined} className="h-8 w-20" aria-label="비교할 값" value={String(clause.value)} onChange={(event) => set({ ...clause, value: type === 'number' ? Number(event.target.value) : event.target.value })} />}
              </>
            )}
          </>
        );
      }
      case 'error':
        return <>실패 종류 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="실패 종류" value={clause.errorKind} onChange={(errorKind) => set({ ...clause, errorKind: errorKind as typeof clause.errorKind })} className="w-36">{ITEM_ERROR_KIND_IDS.map((id) => <SelectItem key={id} value={id}>{ITEM_ERROR_KINDS[id]}</SelectItem>)}</Pick></>;
      case 'termStatus':
        return <>용어 상태 <Negate not={clause.not} words={['=', '≠']} onChange={(not) => set({ ...clause, not })} /> <Pick label="용어 상태" value={clause.status} onChange={(status) => set({ ...clause, status })} className="w-28">{KNOWLEDGE_STATUSES.map((status) => <SelectItem key={status} value={status}>{KNOWLEDGE_STATUS_LABELS[status]}</SelectItem>)}</Pick></>;
      case 'hasTarget':
        return <>표기 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'uses':
        return <>쓰인 대사 <Pick label="비교" value={clause.op} onChange={(value) => set({ ...clause, op: value as '>=' | '<=' })} className="w-16"><SelectItem value=">=">≥</SelectItem><SelectItem value="<=">≤</SelectItem></Pick> <NumberInput min={0} className="h-8 w-20" aria-label="쓰인 대사 수" value={clause.value} onValueChange={(value) => value !== undefined && set({ ...clause, value })} /> 줄</>;
      case 'listener':
        return <>청자 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
      case 'candidate':
        return <>번역문 <Negate not={clause.not} words={['있음', '없음']} onChange={(not) => set({ ...clause, not })} /></>;
    }
  };

  return (
    <InspectorFields>
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
          <div className="flex shrink-0 items-center gap-2">
            {!json && condition.clauses.length > 1 && (
              <Pick label="묶는 방식" value={condition.join} onChange={(join) => write({ ...condition, join: join as Join })} className="w-32">
                <SelectItem value="and">모두 만족</SelectItem>
                <SelectItem value="or">하나라도 만족</SelectItem>
              </Pick>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              JSON
              <Switch checked={json} disabled={!parsed} onCheckedChange={setAsJson} />
            </label>
          </div>
        }
      >
        {json ? (
          <div className="space-y-1">
            <Textarea
              value={text}
              spellCheck={false}
              readOnly={readOnly}
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
          </div>
        ) : (
          <div className="space-y-1.5">
            {condition.clauses.map((clause, index) => (
              <div key={index} className="flex min-w-0 items-center gap-1.5 text-sm">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{row(clause, index)}</div>
                {!readOnly && (
                  <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" aria-label="조건 빼기" onClick={() => removeClause(index)}>
                    <X />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="-ml-2 text-muted-foreground"><Plus /> 조건</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {addable.map((kind) => (
                    <DropdownMenuItem key={kind} onClick={() => write({ ...condition, clauses: [...condition.clauses, fresh(kind)!] })}>{ADDABLE[kind]}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </Field>
    </InspectorFields>
  );
}
