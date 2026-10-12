import { AGENT_TOOLS } from '@tw/shared';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check, ChevronRight, CircleAlert, Network, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { workflowEdits, type WorkflowNodeEdit } from '@/lib/workflow-edits';
import { ProposalCard, type Proposal } from './proposal-card';
import { Markdown } from './markdown';
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

export const LABEL: Record<string, string> = Object.fromEntries(Object.entries(AGENT_TOOLS).map(([name, info]) => [name, info.label]));

/** A readable preview of what an approval-gated tool would change. */
export function ChangePreview({ name, input }: { name: string; input: Record<string, unknown> }) {
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
        <Markdown>{value}</Markdown>
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
      return <dl className="space-y-1">{field('작업', action)}{field('제목', input.title)}{field('종류', input.kind)}{field('번역 문맥에 넣기', input.alwaysInclude ? '예' : '아니오')}{markdown(input.body)}</dl>;
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
    case 'propose_changes': {
      const changes = (input.changes as { key: string; translation?: string; status?: string; addTags?: string[]; removeTags?: string[] }[] | undefined) ?? [];
      // A large batch arrives as its first lines plus counts (see routes/proposals.ts).
      const counts = input.counts as { lines: number; translations: number; statuses: number; tagged: number } | undefined;
      const translations = counts?.translations ?? changes.filter((change) => change.translation !== undefined).length;
      const statuses = counts?.statuses ?? changes.filter((change) => change.status).length;
      const tagged = counts?.tagged ?? changes.filter((change) => change.addTags?.length || change.removeTags?.length).length;
      return (
        <div className="space-y-2">
          <p>
            대사 <b>{(counts?.lines ?? changes.length).toLocaleString()}</b>개 · 번역 {translations.toLocaleString()} · 상태 {statuses.toLocaleString()} · 태그 {tagged.toLocaleString()}
            {counts && changes.length < counts.lines && <span className="text-muted-foreground"> · 처음 {changes.length}개만 표시</span>}
          </p>
          <ul className="max-h-56 space-y-1 overflow-auto">
            {changes.slice(0, 50).map((change) => (
              <li key={change.key} className="rounded border px-2 py-1">
                <span className="font-mono text-xs text-muted-foreground">{change.key}</span>
                {change.translation !== undefined && <span className="block">{change.translation}</span>}
                {(change.status || change.addTags?.length || change.removeTags?.length) && (
                  <span className="block text-muted-foreground">
                    {[change.status && `→ ${change.status}`, ...(change.addTags ?? []).map((tag) => `+#${tag}`), ...(change.removeTags ?? []).map((tag) => `−#${tag}`)].filter(Boolean).join(' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {changes.length > 50 && <p className="text-muted-foreground">외 {changes.length - 50}개</p>}
          <p className="text-muted-foreground">수락하면 한 번에 반영됩니다. 그사이 다른 곳에서 바뀐 대사는 덮어쓰지 않고 건너뜁니다.</p>
        </div>
      );
    }
    case 'start_run': {
      const count = (key: string) => ((input[key] as unknown[] | undefined) ?? []).length;
      const scope = [count('groupIds') && `장면·묶음 ${count('groupIds')}개`, count('unitIds') && `대사 ${count('unitIds')}개`, count('tagIds') && `태그 ${count('tagIds')}개`].filter(Boolean).join(', ') || '진입 조건에 맞는 모든 대사';
      return (
        <dl className="space-y-1">
          {field('워크플로', input.workflowId)}
          {field('범위', scope)}
          {field('상태 조건', input.ignoreStatus ? '무시하고 실행' : '진입 상태에 맞는 대사만')}
          <p className="text-muted-foreground">수락하면 바로 실행이 시작되고 AI 호출 비용이 듭니다.</p>
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
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">{value}</pre>
        </dl>
      );
    }
    default:
      return <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(input, null, 2)}</pre>;
  }
}

export function ToolPart({ part, stale, onDecide, onOutput, proposal }: {
  part: Part;
  /** For pi chats: the stored proposal a change tool produced (decided with its own buttons). */
  proposal?: Proposal;
  /** Not in the latest reply: an unanswered proposal can no longer be applied. */
  stale?: boolean;
  onDecide: (approvalId: string, approved: boolean) => void;
  /** Result for a tool the browser carries out (edit_workflow_node). */
  onOutput: (toolCallId: string, output: unknown) => void;
}) {
  const name = part.type.slice('tool-'.length);
  const label = LABEL[name] ?? name;
  const isChange = name.startsWith('save_') || name.startsWith('propose_') || name === 'start_run';
  if (proposal) return <ProposalCard proposal={proposal} />;

  if (name === 'edit_workflow_node' && part.input && (part.state === 'input-available' || part.state === 'output-available')) {
    const output = part.output as { applied?: boolean } | undefined;
    return (
      <div className="overflow-hidden rounded-lg border bg-background text-sm">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
          <Wrench className="size-3.5 text-muted-foreground" /> {label}
          <span className="ml-auto">
            {output?.applied === true && <span className="text-success">편집기에 적용됨 · 저장 필요</span>}
            {output?.applied === false && <span className="text-muted-foreground">거절함</span>}
            {!output && stale && <span className="text-muted-foreground">응답하지 않음</span>}
          </span>
        </div>
        <div className="px-3 py-2 text-xs">
          <ChangePreview name={name} input={part.input} />
        </div>
        {part.state === 'input-available' && !stale && (
          <div className="flex justify-end gap-2 border-t px-3 py-2">
            <Button variant="outline" onClick={() => onOutput(part.toolCallId, { applied: false, reason: '사용자가 거절했습니다.' })}>
              <X /> 거절
            </Button>
            <Button
             
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
            {part.state === 'output-available' && !failed && <span className="text-success">적용됨</span>}
            {failed && <span className="text-destructive">{String((part.output as { error?: string }).error ?? '실패')}</span>}
            {part.state === 'approval-responded' && <Spinner className="size-3" />}
          </span>
        </div>
        <div className="px-3 py-2 text-xs">{part.input && <ChangePreview name={name} input={part.input} />}</div>
        {!decided && part.approval && (
          <div className="flex justify-end gap-2 border-t px-3 py-2">
            <Button variant="outline" onClick={() => onDecide(part.approval!.id, false)}>
              <X /> 거절
            </Button>
            <Button onClick={() => onDecide(part.approval!.id, true)}>
              <Check /> 수락
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (name === 'show_graph' && part.state === 'output-available' && (part.output as GraphViewOutput)?.ok) return <GraphViewLink output={part.output as GraphViewOutput} />;

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        {part.state === 'output-error' ? <CircleAlert className="size-3.5 text-destructive" /> : part.state === 'output-available' ? <Check className="size-3.5" /> : <Spinner className="size-3.5" />}
        {label}
        {part.input && 'sceneId' in part.input && part.input.offset ? <span>· {String(part.input.offset)}번째부터</span> : null}
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs">
          {part.state === 'output-error' ? part.errorText : JSON.stringify(part.output ?? part.input, null, 1)?.slice(0, 4000)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface GraphViewOutput {
  ok: true;
  nodes: number;
  label: string;
  open: { to: '/p/$projectId/graph'; search: Record<string, string | undefined> };
}

/** show_graph: the view the agent made, opened with one click. */
function GraphViewLink({ output }: { output: GraphViewOutput }) {
  const navigate = useNavigate();
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const only = String(output.open.search.section ?? '').startsWith('view:');
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs">
      <Network className="size-3.5 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        {output.label} · 노드 {output.nodes.toLocaleString()}개 {only ? '따로 그림' : '강조'}
      </span>
      <Button variant="outline" disabled={!projectId} onClick={() => void navigate({ to: output.open.to, params: { projectId: projectId! }, search: output.open.search as never })}>
        그래프에서 보기
      </Button>
    </div>
  );
}
