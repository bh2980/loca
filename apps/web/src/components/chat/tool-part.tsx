import { Check, ChevronRight, CircleAlert, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { workflowEdits, type WorkflowNodeEdit } from '@/lib/workflow-edits';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';

type State = 'input-streaming' | 'input-available' | 'approval-requested' | 'approval-responded' | 'output-available' | 'output-error' | 'output-denied';

interface Part {
  type: string;
  state: State;
  toolCallId: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean };
}

const LABEL: Record<string, string> = {
  project_overview: '프로젝트 개요 조회',
  list_scenes: '장면 목록 조회',
  read_scene: '장면 읽기',
  search_lines: '대사 검색',
  list_speakers: '화자 목록 조회',
  list_characters: '인물 조회',
  read_documents: '참조 문서 읽기',
  list_terms: '용어집 조회',
  harness_reference: '워크플로 구조 확인',
  read_workflow: '워크플로 읽기',
  read_run: '실행 기록 읽기',
  save_character: '인물 저장',
  save_relationship: '관계 저장',
  save_document: '참조 문서 저장',
  save_terms: '용어 저장',
  save_profile: 'AI 프로필 저장',
  save_workflow: '워크플로 저장',
  save_status: '상태·태그 만들기',
  read_line: '대사 읽기',
  propose_translation: '번역 후보 추가',
  save_group_summary: '장면 요약 저장',
  edit_workflow_node: '워크플로 노드 수정',
};

/** A readable preview of what an approval-gated tool would change. */
function ChangePreview({ name, input }: { name: string; input: Record<string, unknown> }) {
  const field = (label: string, value: unknown) =>
    value === undefined || value === '' ? null : (
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words">{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
      </div>
    );
  const markdown = (value: unknown) =>
    typeof value === 'string' && value ? (
      <div className="prose-chat max-h-64 overflow-auto rounded-md border bg-muted/30 px-3 py-2">
        <ReactMarkdown>{value}</ReactMarkdown>
      </div>
    ) : null;
  const action = input.id ? '수정' : '새로 만들기';
  switch (name) {
    case 'save_character':
      return (
        <dl className="space-y-1">
          {field('작업', action)}
          {field('이름', input.name)}
          {field('별칭', input.aliases)}
          {markdown(input.profile)}
        </dl>
      );
    case 'save_relationship':
      return <dl className="space-y-1">{field('작업', action)}{field('관계', `${input.from} → ${input.to} (${input.kind})`)}{field('양방향', input.mutual ? '예' : '아니오')}{field('설명', input.description)}</dl>;
    case 'save_document':
      return <dl className="space-y-1">{field('작업', action)}{field('제목', input.title)}{field('종류', input.kind)}{field('항상 포함', input.alwaysInclude ? '예' : '아니오')}{markdown(input.body)}</dl>;
    case 'save_terms': {
      const terms = (input.terms as { source: string; target: string; id?: string }[]) ?? [];
      return (
        <ul className="max-h-48 space-y-0.5 overflow-auto">
          {terms.map((term, index) => (
            <li key={index}>
              {term.id ? '수정' : '추가'} · <b>{term.source}</b> → {term.target || '(번역 없음)'}
            </li>
          ))}
        </ul>
      );
    }
    case 'save_profile':
      return <dl className="space-y-1">{field('작업', action)}{field('이름', input.name)}{field('모델', input.model)}{field('추론', input.effort)}{markdown(input.instructions)}</dl>;
    case 'save_workflow': {
      const definition = input.definition as { nodes?: { type: string; label?: string }[]; edges?: unknown[] } | undefined;
      return (
        <dl className="space-y-1">
          {field('작업', action)}
          {field('이름', input.name)}
          {field('노드', definition?.nodes?.map((node) => node.label ?? node.type))}
          {field('연결', definition?.edges?.length)}
        </dl>
      );
    }
    case 'propose_translation':
      return <dl className="space-y-1">{field('번역', input.text)}{field('메모', input.note)}</dl>;
    case 'save_group_summary':
      return <dl className="space-y-1">{field('요약', input.description)}<p className="text-muted-foreground">AI 번역 노드가 이 장면의 문맥으로 받습니다.</p></dl>;
    case 'edit_workflow_node': {
      const value = input.field === 'expression' ? JSON.stringify(input.value, null, 2) : String(input.value ?? '');
      return (
        <dl className="space-y-1">
          {field('노드', input.nodeId)}
          {field('항목', { instructions: '지시문', expression: '조건식', code: '스크립트 코드' }[input.field as string])}
          {field('설명', input.description)}
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 text-[11px] whitespace-pre-wrap">{value}</pre>
        </dl>
      );
    }
    default:
      return <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(input, null, 2)}</pre>;
  }
}

export function ToolPart({ part, stale, onDecide, onOutput }: {
  part: Part;
  /** Not in the latest reply: an unanswered proposal can no longer be applied. */
  stale?: boolean;
  onDecide: (approvalId: string, approved: boolean) => void;
  /** Result for a tool the browser carries out (edit_workflow_node). */
  onOutput: (toolCallId: string, output: unknown) => void;
}) {
  const name = part.type.slice('tool-'.length);
  const label = LABEL[name] ?? name;
  const isChange = name.startsWith('save_') || name === 'propose_translation';

  if (name === 'edit_workflow_node' && part.input && (part.state === 'input-available' || part.state === 'output-available')) {
    const output = part.output as { applied?: boolean } | undefined;
    return (
      <div className="overflow-hidden rounded-lg border bg-background text-sm">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
          <Wrench className="size-3.5 text-muted-foreground" /> {label}
          <span className="ml-auto">
            {output?.applied === true && <span className="text-emerald-600">편집기에 적용됨 · 저장 필요</span>}
            {output?.applied === false && <span className="text-muted-foreground">거절함</span>}
            {!output && stale && <span className="text-muted-foreground">응답하지 않음</span>}
          </span>
        </div>
        <div className="px-3 py-2 text-xs">
          <ChangePreview name={name} input={part.input} />
        </div>
        {part.state === 'input-available' && !stale && (
          <div className="flex justify-end gap-2 border-t px-3 py-2">
            <Button size="sm" variant="outline" onClick={() => onOutput(part.toolCallId, { applied: false, reason: '사용자가 거절했습니다.' })}>
              <X /> 거절
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const error = workflowEdits.apply(part.input as unknown as WorkflowNodeEdit);
                if (error) toast.error(error);
                else onOutput(part.toolCallId, { applied: true, note: '편집기 초안에 들어갔습니다. 사용자가 저장해야 반영됩니다.' });
              }}
            >
              <Check /> 편집기에 적용
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isChange && (part.state === 'approval-requested' || part.state === 'approval-responded' || part.state === 'output-available' || part.state === 'output-denied')) {
    const decided = part.state !== 'approval-requested';
    const failed = part.state === 'output-available' && (part.output as { ok?: boolean })?.ok === false;
    return (
      <div className="overflow-hidden rounded-lg border bg-background text-sm">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
          <Wrench className="size-3.5 text-muted-foreground" /> {label}
          <span className="ml-auto">
            {part.state === 'output-denied' && <span className="text-muted-foreground">거절함</span>}
            {part.state === 'output-available' && !failed && <span className="text-emerald-600">적용됨</span>}
            {failed && <span className="text-destructive">{String((part.output as { error?: string }).error ?? '실패')}</span>}
            {part.state === 'approval-responded' && <Spinner className="size-3" />}
          </span>
        </div>
        <div className="px-3 py-2 text-xs">{part.input && <ChangePreview name={name} input={part.input} />}</div>
        {!decided && part.approval && (
          <div className="flex justify-end gap-2 border-t px-3 py-2">
            <Button size="sm" variant="outline" onClick={() => onDecide(part.approval!.id, false)}>
              <X /> 거절
            </Button>
            <Button size="sm" onClick={() => onDecide(part.approval!.id, true)}>
              <Check /> 수락
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        {part.state === 'output-error' ? <CircleAlert className="size-3.5 text-destructive" /> : part.state === 'output-available' ? <Check className="size-3.5" /> : <Spinner className="size-3.5" />}
        {label}
        {part.input && 'sceneId' in part.input && part.input.offset ? <span>· {String(part.input.offset)}번째부터</span> : null}
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-[11px]">
          {part.state === 'output-error' ? part.errorText : JSON.stringify(part.output ?? part.input, null, 1)?.slice(0, 4000)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
