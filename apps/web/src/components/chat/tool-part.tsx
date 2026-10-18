import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { Check, ChevronRight, CircleAlert, Network, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { acceptedLabel, AGENT_TOOLS, agentPermissionError, findReadingRouteOutputSchema } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { workflowEdits, type WorkflowNodeEdit } from '@/lib/workflow-edits';
import { ChangePreview, LABEL } from './change-preview';
import { ProposalCard, type Proposal } from './proposal-card';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Spinner } from '@loca/ui';

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
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const [checkingWorkflowPermission, setCheckingWorkflowPermission] = useState(false);
  const label = LABEL[name] ?? name;
  const isChange = Boolean(AGENT_TOOLS[name] && AGENT_TOOLS[name].action !== 'read');
  if (proposal) return <ProposalCard proposal={proposal} />;

  if (name === 'edit_workflow_node' && part.input && (part.state === 'input-available' || part.state === 'output-available')) {
    const output = part.output as { applied?: boolean; reason?: string } | undefined;
    return (
      <div className="overflow-hidden rounded-lg border bg-background text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted px-3 py-1.5 text-xs font-medium">
          <CardTitle>{label}</CardTitle>
          <span className="ml-auto text-right">
            {output?.applied === true && <span className="text-success">편집기에 적용됨 · 자동 저장 예정</span>}
            {output?.applied === false && <span className="text-muted-foreground">{output.reason === '사용자가 거절했습니다.' ? '거절함' : '적용하지 않음'}</span>}
            {!output && stale && <span className="text-muted-foreground">응답하지 않음</span>}
          </span>
        </div>
        <div className="px-3 py-2 text-xs">
          <ChangePreview name={name} input={part.input} />
        </div>
        {part.state === 'input-available' && !stale && (
          <div className="flex justify-end gap-2 border-t px-3 py-2">
            <Button variant="outline" disabled={checkingWorkflowPermission} onClick={() => onOutput(part.toolCallId, { applied: false, reason: '사용자가 거절했습니다.' })}>
              <X /> 거절
            </Button>
            <Button
              disabled={checkingWorkflowPermission}
              onClick={async () => {
                if (checkingWorkflowPermission) return;
                setCheckingWorkflowPermission(true);
                try {
                  if (!projectId) throw new Error('프로젝트 권한을 확인할 수 없습니다. 프로젝트 화면에서 다시 시도하세요.');
                  // This browser-carried tool does not execute on the server, so recheck the
                  // project's current policy immediately before applying its edit to the draft.
                  const project = await unwrap(client.projects[':projectId'].$get({ param: { projectId } }));
                  const permissionError = agentPermissionError(project.agentSettings ?? {}, name, part.input!);
                  if (permissionError) {
                    toast.error(permissionError);
                    onOutput(part.toolCallId, { applied: false, reason: permissionError });
                    return;
                  }
                  const error = workflowEdits.apply(part.input as unknown as WorkflowNodeEdit);
                  if (error) {
                    toast.error(error);
                    onOutput(part.toolCallId, { applied: false, reason: error });
                  } else {
                    onOutput(part.toolCallId, { applied: true, note: '편집기 초안에 적용했습니다. 자동 저장됩니다.' });
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : '현재 권한을 확인하지 못해 적용하지 않았습니다.';
                  toast.error(message);
                  onOutput(part.toolCallId, { applied: false, reason: message });
                } finally {
                  setCheckingWorkflowPermission(false);
                }
              }}
            >
              <Check /> {checkingWorkflowPermission ? '권한 확인 중…' : '편집기에 적용'}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isChange && (part.state === 'approval-requested' || part.state === 'approval-responded' || part.state === 'output-available' || part.state === 'output-denied')) {
    const decided = part.state !== 'approval-requested';
    // A gated change answers with its proposal's status (#45): a change that was tried and failed is not 적용됨.
    const output = part.output as { ok?: boolean; status?: string; error?: string; note?: string } | undefined;
    const failed = part.state === 'output-available' && (output?.ok === false || output?.status === 'failed' || output?.status === 'rejected');
    const waiting = part.state === 'output-available' && (output?.status === 'pending' || output?.status === 'running');
    // Refused before it became a proposal ('제안하지 못했습니다: …'): there is nothing to accept.
    const refused = part.state === 'output-available' && output?.ok === false && !output?.status;
    return (
      <div className="overflow-hidden rounded-lg border bg-background text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted px-3 py-1.5 text-xs font-medium">
          <CardTitle>{label}</CardTitle>
          <span className="ml-auto text-right">
            {part.state === 'output-denied' && <span className="text-muted-foreground">거절함</span>}
            {part.state === 'output-available' && !failed && !waiting && <span className="text-success">{acceptedLabel(name).short}</span>}
            {waiting && <span className="text-muted-foreground">결정 기다리는 중</span>}
            {failed && <span className="text-destructive">{output?.status === 'rejected' ? '거절함' : String(output?.error ?? '실패')}</span>}
            {part.state === 'approval-responded' && <Spinner className="size-3" />}
          </span>
        </div>
        <div className="px-3 py-2 text-xs">
          {part.input &&
            (refused ? (
              // Nothing was proposed (the check refused it): what the agent asked for, folded, not as items to add.
              <details>
                <summary className="cursor-pointer text-muted-foreground">요청한 내용 보기</summary>
                <div className="mt-2">
                  <ChangePreview name={name} input={part.input} pending={false} />
                </div>
              </details>
            ) : (
              <ChangePreview name={name} input={part.input} pending={!decided} />
            ))}
        </div>
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
  if (name === 'find_reading_route' && (part.state === 'output-available' || part.state === 'output-error')) {
    const parsed = findReadingRouteOutputSchema.safeParse(part.output);
    return <ReadingRouteToolCard output={parsed.success ? parsed.data : { ok: false as const, error: part.errorText ?? '경로 대본을 만들지 못했습니다.' }} />;
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
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
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

/** Compact, evidence-bearing route result; the full path is loaded only when opened in the graph. */
function ReadingRouteToolCard({ output }: { output: ReturnType<typeof findReadingRouteOutputSchema.parse> }) {
  const navigate = useNavigate();
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  if (!output.ok) return <div className="rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs" role="status">
    <div className="flex items-center gap-2 font-medium text-destructive"><CircleAlert className="size-3.5" />경로 대본</div>
    <p className="mt-1 text-foreground">{output.error}</p>
  </div>;
  return <div className="overflow-hidden rounded-lg border bg-background text-sm">
    <div className="flex items-center gap-2 border-b bg-muted px-3 py-1.5 text-xs font-medium">
      <Network className="size-3.5 text-muted-foreground" />
      <span>경로 대본</span>
      <span className="ml-auto font-normal text-muted-foreground">대사 {output.lineCount.toLocaleString()}줄</span>
    </div>
    <div className="grid gap-2 px-3 py-2 text-xs">
      <RouteEndpoint label="시작" endpoint={output.start} />
      <RouteEndpoint label="끝" endpoint={output.end} />
    </div>
    <div className="flex justify-end border-t px-3 py-2">
      <Button variant="outline" disabled={!projectId} onClick={() => void navigate({ to: '/p/$projectId/graph', params: { projectId: projectId! }, search: { scope: 'dialogue', routeStart: output.open.search.routeStart, routeEnd: output.open.search.routeEnd } as never })}>
        경로 따라 번역 열기
      </Button>
    </div>
  </div>;
}

function RouteEndpoint({ label, endpoint }: { label: string; endpoint: { key: string; source: string; speaker?: string } }) {
  return <Collapsible className="min-w-0 rounded-md bg-muted/50 px-2 py-1.5">
    <CollapsibleTrigger className="group flex w-full min-w-0 flex-col items-start text-left">
      <span className="text-subtle-foreground">{label} · {endpoint.key}{endpoint.speaker ? ` · ${endpoint.speaker}` : ''}</span>
      <span className="mt-0.5 line-clamp-2 break-words text-foreground" title={endpoint.source}>{endpoint.source}</span>
      <span className="mt-1 text-subtle-foreground">원문 펼쳐 보기 <ChevronRight className="inline size-3 transition-transform group-data-[state=open]:rotate-90" /></span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <p className="mt-2 whitespace-pre-wrap break-words border-t border-border-subtle pt-2 text-foreground">{endpoint.source}</p>
    </CollapsibleContent>
  </Collapsible>;
}

/** A card's title on one line (narrow panel: the status wraps below instead of breaking the title). */
function CardTitle({ children }: { children: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap" title={children}>
      <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </span>
  );
}
