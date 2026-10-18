/** Config of a condition node: common conditions as a form, anything else as JSON Logic. */
import { useEffect, useState } from 'react';
import { AUTO_MARKS, type AutoMark, CONDITION_MARK_IDS } from '@tw/shared';
import { nodeName, type WorkflowNode } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, HelpTip } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { Field, type ConditionNode } from '@/components/workflow/node-config/shared';

// ── condition node ────────────────────────────────────────────────────

/** Nodes whose output has a `passed` flag a condition can test. */
export const hasVerdict = (node: WorkflowNode) =>
  (node.type === 'ai' && node.config.output === 'verdict') ||
  (node.type === 'function' && (node.config.fn === 'formatCheck' || node.config.fn === 'glossaryCheck' || (node.config.fn === 'http' && (node.config.params as { mode?: string }).mode === 'verdict')));

/** Common conditions as a form; anything else is plain JSON Logic. */
export function ConditionEditor({ node, nodes, readOnly, onChange }: { node: ConditionNode; nodes: WorkflowNode[]; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
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
          <p className="flex items-center gap-1 text-xs text-muted-foreground">자주 쓰는 조건 <HelpTip>예: 'AI 검수' 방문 3회 미만 → 거짓 출구를 사람 확인에 연결하면 "검수 3번 불통이면 사람 검토".</HelpTip></p>
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
