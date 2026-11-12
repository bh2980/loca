import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { Check, CircleAlert, Network, X } from 'lucide-react';
import { toast } from 'sonner';
import { acceptedLabel, findReadingRouteOutputSchema, toolRoute, toolSpec } from '@tw/shared';
import { client, unwrap } from '@/lib/api';
import { workflowEdits, type WorkflowNodeEdit } from '@/lib/workflow-edits';
import { LABEL } from './change-preview';
import { ProposalCard, type Proposal } from './proposal-card';
import { Box, Button, Grid, Icon, Inline, SourceExcerpt, Stack, Text, ToolCallRow, ToolCard, ToolCardHeader, ToolErrorCard } from '@loca/ui';

type State = 'input-streaming' | 'input-available' | 'output-available' | 'output-error';

interface Part {
  type: string;
  state: State;
  toolCallId: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
}

export function ToolPart({ part, stale, onOutput, proposal }: {
  part: Part;
  /** For CLI chats: the stored proposal a change tool produced (decided with its own buttons). */
  proposal?: Proposal;
  /** Not in the latest reply: an unanswered proposal can no longer be applied. */
  stale?: boolean;
  /** Result for a tool the browser carries out (edit_workflow_node). */
  onOutput: (toolCallId: string, output: unknown) => void;
}) {
  const name = part.type.slice('tool-'.length);
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const [checkingWorkflowPermission, setCheckingWorkflowPermission] = useState(false);
  const label = LABEL[name] ?? name;
  const isChange = Boolean(toolSpec(name)) && toolRoute(name) === 'gate';
  if (proposal) return <ProposalCard proposal={proposal} />;

  if (name === 'edit_workflow_node' && part.input && (part.state === 'input-available' || part.state === 'output-available')) {
    const output = part.output as { applied?: boolean; reason?: string } | undefined;
    return (
      <ToolCard>
        <ToolCardHeader title={label}>
          {output?.applied === true && <Text tone="success">편집기에 적용됨 · 자동 저장 예정</Text>}
          {output?.applied === false && <Text tone="muted">{output.reason === '사용자가 거절했습니다.' ? '거절함' : '적용하지 않음'}</Text>}
          {!output && stale && <Text tone="muted">응답하지 않음</Text>}
        </ToolCardHeader>
        <Box paddingX="normal" paddingY="condensed" variant="body">
          <NodeEditPreview input={part.input} />
        </Box>
        {part.state === 'input-available' && !stale && (
          <Stack direction="row" justify="end" gap="condensed" border="top" paddingX="normal" paddingY="condensed">
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
                  // This tool is carried out here, not on the server, so the server is asked right before
                  // the edit goes into the draft whether the project's agent permissions (as they are now) allow it.
                  const { denied: permissionError } = await unwrap(client.projects[':projectId']['editor-tools'][':name'].permission.$post({ param: { projectId, name }, json: part.input! }));
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
          </Stack>
        )}
      </ToolCard>
    );
  }

  if (isChange && part.state === 'output-available') {
    // A gated change answers with its proposal's status (#45): a change that was tried and failed is not 적용됨.
    const output = part.output as { ok?: boolean; status?: string; error?: string; note?: string } | undefined;
    const failed = output?.ok === false || output?.status === 'failed' || output?.status === 'rejected';
    const waiting = output?.status === 'pending' || output?.status === 'running';
    // Refused before it became a proposal ('제안하지 못했습니다: …'): there is nothing to accept.
    const refused = output?.ok === false && !output?.status;
    return (
      <ToolCard>
        <ToolCardHeader title={label}>
          {!failed && !waiting && <Text tone="success">{acceptedLabel(name).short}</Text>}
          {waiting && <Text tone="muted">결정 기다리는 중</Text>}
          {failed && <Text tone="danger">{output?.status === 'rejected' ? '거절함' : String(output?.error ?? '실패')}</Text>}
        </ToolCardHeader>
        {/* The proposal's card says what it changes (its details, from the server); without one (the check refused it, or its row is not here yet) only what the agent asked for is left. */}
        {part.input && (
          <Box paddingX="normal" paddingY="condensed" variant="body">
            <details>
              <Text as="summary" cursor="pointer" tone="muted">{refused ? '요청한 내용 보기' : '보낸 내용 보기'}</Text>
              <Text as="pre" marginTop="condensed" maxHeight="scroll-sm" overflow="auto" variant="caption" preserveLines>{JSON.stringify(part.input, null, 2).slice(0, 4000)}</Text>
            </details>
          </Box>
        )}
      </ToolCard>
    );
  }

  if (name === 'show_graph' && part.state === 'output-available' && (part.output as GraphViewOutput)?.ok) return <GraphViewLink output={part.output as GraphViewOutput} />;
  if (name === 'find_reading_route' && (part.state === 'output-available' || part.state === 'output-error')) {
    const parsed = findReadingRouteOutputSchema.safeParse(part.output);
    return <ReadingRouteToolCard output={parsed.success ? parsed.data : { ok: false as const, error: part.errorText ?? '경로 대본을 만들지 못했습니다.' }} />;
  }

  return (
    <ToolCallRow
      // Only a call still taking its input is running: any other state (one a stored conversation has that this page does not know) is a finished call.
      status={part.state === 'output-error' ? 'error' : part.state === 'input-streaming' || part.state === 'input-available' ? 'running' : 'done'}
      label={label}
      detail={part.input && 'sceneId' in part.input && part.input.offset ? <span>· {String(part.input.offset)}번째부터</span> : null}
      output={part.state === 'output-error' ? part.errorText : JSON.stringify(part.output ?? part.input, null, 1)?.slice(0, 4000)}
    />
  );
}

/** edit_workflow_node as the editor shows it before applying: this tool is the browser's own (the open editor carries it out), so its card is drawn here. */
function NodeEditPreview({ input }: { input: Record<string, unknown> }) {
  const value = input.field === 'expression' ? JSON.stringify(input.value, null, 2) : String(input.value ?? '');
  const rows = [['노드', input.nodeId], ['항목', { instructions: '지시문', expression: '조건식', code: '스크립트 코드' }[String(input.field)]], ['설명', input.description]].filter(([, shown]) => shown !== undefined && shown !== '');
  return (
    <Box as="dl" spaceY="tight">
      {rows.map(([label, shown]) => (
        <Grid key={String(label)} columns="field" gap="condensed">
          <Text as="dt" variant="caption" tone="muted">{String(label)}</Text>
          <Text as="dd" minWidth={0} breakWords>{String(shown)}</Text>
        </Grid>
      ))}
      <Text as="pre" maxHeight="scroll" overflow="auto" radius="md" border="all" background="sunken" padding="condensed" variant="caption" preserveLines>{value}</Text>
    </Box>
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
    <Inline gap="condensed" radius="lg" border="all" background="page" paddingX="normal" paddingY="condensed" variant="caption">
      <Icon icon={Network} size="sm" tone="muted" />
      <Text minWidth={0} grow truncate>
        {output.label} · 노드 {output.nodes.toLocaleString()}개 {only ? '따로 그림' : '강조'}
      </Text>
      <Button variant="outline" disabled={!projectId} onClick={() => void navigate({ to: output.open.to, params: { projectId: projectId! }, search: output.open.search as never })}>
        그래프에서 보기
      </Button>
    </Inline>
  );
}

/** Compact, evidence-bearing route result; the full path is loaded only when opened in the graph. */
function ReadingRouteToolCard({ output }: { output: ReturnType<typeof findReadingRouteOutputSchema.parse> }) {
  const navigate = useNavigate();
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  if (!output.ok) return <ToolErrorCard>
    <Inline gap="condensed" weight="medium" tone="danger"><Icon icon={CircleAlert} size="sm" />경로 대본</Inline>
    <Text as="p" marginTop="tight">{output.error}</Text>
  </ToolErrorCard>;
  return <ToolCard>
    <Inline gap="condensed" border="bottom" background="sunken" paddingX="normal" paddingY="condensed" variant="body" weight="semibold">
      <Icon icon={Network} size="sm" tone="muted" />
      <span>경로 대본</span>
      <Text marginLeft="auto" weight="normal" tone="muted">대사 {output.lineCount.toLocaleString()}줄</Text>
    </Inline>
    <Grid gap="condensed" paddingX="normal" paddingY="condensed" variant="body">
      <RouteEndpoint label="시작" endpoint={output.start} />
      <RouteEndpoint label="끝" endpoint={output.end} />
    </Grid>
    <Stack direction="row" justify="end" border="top" paddingX="normal" paddingY="condensed">
      <Button variant="outline" disabled={!projectId} onClick={() => void navigate({ to: '/p/$projectId/graph', params: { projectId: projectId! }, search: { scope: 'dialogue', routeStart: output.open.search.routeStart, routeEnd: output.open.search.routeEnd } as never })}>
        경로 따라 번역 열기
      </Button>
    </Stack>
  </ToolCard>;
}

function RouteEndpoint({ label, endpoint }: { label: string; endpoint: { key: string; source: string; speaker?: string } }) {
  return <SourceExcerpt heading={`${label} · ${endpoint.key}${endpoint.speaker ? ` · ${endpoint.speaker}` : ''}`} text={endpoint.source} expandLabel="원문 펼쳐 보기" />;
}
