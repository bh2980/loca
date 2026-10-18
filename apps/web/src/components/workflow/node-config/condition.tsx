/** Config of a condition node: common conditions as a form, anything else as JSON Logic. */
import { useEffect, useState } from 'react';
import { AUTO_MARKS, type AutoMark, CONDITION_MARK_IDS } from '@tw/shared';
import { nodeName, type JsonField, type WorkflowNode } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusIcon, TagChip, Textarea } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { Field, type ConditionNode, type NodeRefs } from '@/components/workflow/node-config/shared';

// ── condition node ────────────────────────────────────────────────────

/** Nodes whose output has a `passed` flag a condition can test. */
export const hasVerdict = (node: WorkflowNode) =>
  (node.type === 'ai' && node.config.output === 'verdict') ||
  (node.type === 'function' && (node.config.fn === 'formatCheck' || node.config.fn === 'glossaryCheck' || (node.config.fn === 'http' && (node.config.params as { mode?: string }).mode === 'verdict')));

/** Nodes that hand declared fields to later conditions (outputs.<id>.<field>): an AI JSON output or a script with `data` fields. */
const declaredFields = (node: WorkflowNode): JsonField[] =>
  node.type === 'ai' && node.config.output === 'json' ? node.config.fields : node.type === 'function' && node.config.fn === 'script' ? ((node.config.params as { fields?: JsonField[] }).fields ?? []).filter((field) => field.name) : [];

const OPERATORS = { '>=': '이상', '<=': '이하', '==': '같음', '!=': '다름' } as const;
type Operator = keyof typeof OPERATORS;

const KIND_LABELS: Record<string, string> = {
  dialogue: '대사',
  ui: 'UI 문자열',
  document: '문서·교재',
};

/** Common conditions as a form; anything else is plain JSON Logic. */
export function ConditionEditor({ node, nodes, refs, readOnly, onChange }: { node: ConditionNode; nodes: WorkflowNode[]; refs?: NodeRefs; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
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
  const statuses = refs?.statuses ?? [];
  const tags = refs?.tags ?? [];
  const [target, setTarget] = useState(others.find((other) => other.id === 'review')?.id ?? others[0]?.id ?? '');
  const [limit, setLimit] = useState(3);
  const [passNode, setPassNode] = useState(verdicts[0]?.id ?? '');
  const [mark, setMark] = useState<AutoMark>(CONDITION_MARK_IDS[0]);
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? '');
  const [tagId, setTagId] = useState(tags[0]?.id ?? '');
  const classifiers = nodes.filter((other) => other.type === 'ai' && other.config.output === 'listener');
  const fielded = nodes.filter((other) => declaredFields(other).length > 0);
  const [classifier, setClassifier] = useState(classifiers[0]?.id ?? '');
  const [threshold, setThreshold] = useState(0.9);
  const [answer, setAnswer] = useState('');
  const [fieldNode, setFieldNode] = useState(fielded[0]?.id ?? '');
  const [fieldName, setFieldName] = useState('');
  const [operator, setOperator] = useState<Operator>('==');
  const [operand, setOperand] = useState('');
  const fieldList = declaredFields(nodes.find((other) => other.id === fieldNode) ?? node);
  const pickedField = fieldList.find((field) => field.name === fieldName) ?? fieldList[0];
  const [lineKind, setLineKind] = useState<'dialogue' | 'ui' | 'document'>('dialogue');
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

          {statuses.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              상태가
              <Select value={statusId || statuses[0]!.id} onValueChange={setStatusId}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((st) => (
                    <SelectItem key={st.id} value={st.id}>
                      <StatusIcon status={st} /> {st.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              임
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const picked = statuses.find((st) => st.id === (statusId || statuses[0]!.id));
                  if (picked) apply({ '==': [{ var: 'unit.statusId' }, picked.id] }, `상태가 '${picked.name}'`);
                }}
              >
                적용
              </Button>
            </div>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              줄에
              <Select value={tagId || tags[0]!.id} onValueChange={setTagId}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tags.map((tg) => (
                    <SelectItem key={tg.id} value={tg.id}>
                      <TagChip tag={tg} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              태그가 있음
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const picked = tags.find((tg) => tg.id === (tagId || tags[0]!.id));
                  if (picked) apply({ in: [picked.id, { var: 'unit.tagIds' }] }, `'${picked.name}' 태그가 있음`);
                }}
              >
                적용
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            종류가
            <Select value={lineKind} onValueChange={(v) => setLineKind(v as 'dialogue' | 'ui' | 'document')}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            임
            <Button variant="secondary" onClick={() => apply({ '==': [{ var: 'unit.kind' }, lineKind] }, `${KIND_LABELS[lineKind]} 줄`)}>
              적용
            </Button>
          </div>

          {others.length > 0 && (
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
          )}

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

          {classifiers.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <Select value={classifier} onValueChange={setClassifier}>
                  <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{classifiers.map((other) => <SelectItem key={other.id} value={other.id}>{nodeName(other)}</SelectItem>)}</SelectContent>
                </Select>
                확신도가
                <Input type="number" min={0} max={1} step={0.05} className="h-8 w-16" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
                이상
                <Button variant="secondary" disabled={!classifier} onClick={() => apply({ '>=': [{ var: `outputs.${classifier}.confidence` }, threshold] }, `'${label(classifier)}' 확신도 ${threshold} 이상`)}>적용</Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                '{label(classifier)}' 값이
                <Input className="h-8 w-32" value={answer} placeholder="예: Casual" aria-label="비교할 값" onChange={(event) => setAnswer(event.target.value)} />
                와 같음
                <Button variant="secondary" disabled={!classifier || !answer.trim()} onClick={() => apply({ '==': [{ var: `outputs.${classifier}.value` }, answer.trim()] }, `'${label(classifier)}' 값이 "${answer.trim()}"`)}>적용</Button>
              </div>
            </div>
          )}

          {fielded.length > 0 && pickedField && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <Select value={fieldNode} onValueChange={(value) => { setFieldNode(value); setFieldName(''); }}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{fielded.map((other) => <SelectItem key={other.id} value={other.id}>{nodeName(other)}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={pickedField.name} onValueChange={setFieldName}>
                <SelectTrigger size="sm" className="w-28 font-mono" aria-label="필드"><SelectValue /></SelectTrigger>
                <SelectContent>{fieldList.map((field) => <SelectItem key={field.name} value={field.name}>{field.name}</SelectItem>)}</SelectContent>
              </Select>
              {pickedField.type === 'boolean' ? (
                <Select value={operand === 'false' ? 'false' : 'true'} onValueChange={setOperand}>
                  <SelectTrigger size="sm" className="w-24" aria-label="값"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="true">참</SelectItem><SelectItem value="false">거짓</SelectItem></SelectContent>
                </Select>
              ) : (
                <>
                  <Select value={operator} onValueChange={(value) => setOperator(value as Operator)}>
                    <SelectTrigger size="sm" className="w-24" aria-label="비교"><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(OPERATORS) as Operator[]).filter((op) => pickedField.type === 'number' || op === '==' || op === '!=').map((op) => <SelectItem key={op} value={op}>{OPERATORS[op]}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type={pickedField.type === 'number' ? 'number' : 'text'} className="h-8 w-24" value={operand} aria-label="비교할 값" onChange={(event) => setOperand(event.target.value)} />
                </>
              )}
              <Button
                variant="secondary"
                disabled={pickedField.type !== 'boolean' && operand.trim() === ''}
                onClick={() => {
                  const reference = { var: `outputs.${fieldNode}.${pickedField.name}` };
                  const text = `'${label(fieldNode)}'의 ${pickedField.name}`;
                  if (pickedField.type === 'boolean') {
                    const expected = operand !== 'false';
                    apply({ '==': [reference, expected] }, `${text}이(가) ${expected ? '참' : '거짓'}`);
                  } else {
                    const value = pickedField.type === 'number' ? Number(operand) : operand.trim();
                    apply({ [operator]: [reference, value] }, `${text} ${OPERATORS[operator]} ${value}`);
                  }
                }}
              >
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

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Button variant="outline" onClick={() => apply({ var: 'listenerKnown' }, '청자가 이미 파악됨')}>
              청자가 이미 있나?
            </Button>
            <Button variant="outline" onClick={() => apply({ '!!': { var: 'candidate' } }, '번역문이 있음')}>
              번역문이 있나?
            </Button>
          </div>
        </div>
      )}
      <Field label="조건식 (JSON Logic)" hint={`읽을 수 있는 값: visits.<노드ID>, outputs.<노드ID>.<필드>, candidate, issues, listenerKnown, unit.kind, unit.speaker, unit.statusId, unit.tagIds, unit.marks (${CONDITION_MARK_IDS.join(' · ')})`}>
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
