import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/components/page';
import { InspectorHeader, Inspector, InspectorList, SplitPane, EmptyState, DataTable, type ColumnDef, RunStatusBadge, Box, Button, Icon, Inline, Progress, Spinner, Text, Collapsible, CollapsibleContent, CollapsibleTrigger, Skeleton, ContextMenuItem, ListItem, Section } from '@loca/ui';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { dateTime, clock } from '@/lib/datetime';

interface RunsSearch {
  /** The run or job whose AI requests the right-hand pane shows. */
  job?: string;
}

export const Route = createFileRoute('/p/$projectId/runs/')({
  validateSearch: (raw: Record<string, unknown>): RunsSearch => ({ job: typeof raw.job === 'string' && raw.job ? raw.job : undefined }),
  component: Runs,
});

const JOB_KIND = { run: '워크플로' } as const;
type Stats = { calls: number | null; inputTokens: number; outputTokens: number };

const seconds = (from: Date | string, to: Date | string | null) => {
  if (!to) return '';
  const total = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return total < 60 ? `${total.toFixed(1)}초` : `${Math.floor(total / 60)}분 ${Math.round(total % 60)}초`;
};
const tokens = (stats: Stats | null | undefined) =>
  stats ? `${stats.calls != null ? `${stats.calls.toLocaleString()}회 · ` : ''}${stats.inputTokens.toLocaleString()} / ${stats.outputTokens.toLocaleString()}` : '—';
const startedAt = (at: Date) => dateTime(at);

type Row = {
  id: string;
  kind: keyof typeof JOB_KIND;
  title: string;
  sub: string;
  status: Parameters<typeof RunStatusBadge>[0]['status'];
  error: string | null;
  progress: { done: number; total: number; unit: string } | null;
  stats: Stats | null;
  at: Date;
  workflowId?: string | null;
};

const columns: ColumnDef<Row, unknown>[] = [
  {
    id: 'title',
    header: '작업',
    meta: { hideable: false },
    cell: ({ row }) => (
      <>
        {/* Real spaces between label and value, so the row reads (and copies) as words, not one run (#48). */}
        <Text variant="caption" tone="muted" marginRight="tight">{JOB_KIND[row.original.kind]}</Text>{' '}
        <Text weight="medium">{row.original.title}</Text>
        {row.original.sub && (
          <>
            {' '}
            <Text variant="caption" tone="muted" marginLeft="tight">{row.original.sub}</Text>
          </>
        )}
      </>
    ),
  },
  {
    id: 'status',
    header: '상태',
    meta: { width: 200 },
    cell: ({ row }) => (
      <>
        <RunStatusBadge status={row.original.status} />
        {row.original.error && (
          <Text as="p" marginTop="tight" truncate variant="caption" tone="danger" title={row.original.error}>
            {row.original.error}
          </Text>
        )}
      </>
    ),
  },
  {
    id: 'progress',
    header: '진행',
    meta: { width: 200 },
    cell: ({ row }) => {
      const progress = row.original.progress;
      if (!progress) return <Text variant="caption" tone="muted">—</Text>;
      return (
        <Inline gap="normal">
          <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          <Text shrink={false} align="end" variant="caption" tabular tone="muted">
            {progress.done.toLocaleString()}/{progress.total.toLocaleString()}
            {progress.unit}
          </Text>
        </Inline>
      );
    },
  },
  { id: 'stats', header: 'AI 호출·토큰', meta: { width: 160, align: 'end', variant: 'caption', tone: 'muted' }, cell: ({ row }) => tokens(row.original.stats) },
  { id: 'at', header: '시작', meta: { width: 150, variant: 'caption', tone: 'muted' }, cell: ({ row }) => startedAt(row.original.at) },
];


/**
 * Everything AI did in the project, one row per workflow run, newest first. A run opens its detail page.
 */
function Runs() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const runs = useQuery(q.runs(projectId));
  const jobs = useQuery(q.jobs(projectId));
  const select = (id?: string) => void navigate({ search: { job: id }, replace: true });

  const rows: Row[] | undefined =
    runs.data && jobs.data
      ? [
          ...runs.data.map((run) => ({
            id: run.id,
            kind: 'run' as const,
            title: run.workflowName,
            sub: '',
            status: run.status,
            error: run.status === 'paused' ? run.notice : null,
            progress: { done: (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0), total: run.total, unit: run.subject === 'terms' ? '개' : '줄' },
            stats: jobs.data.runCalls[run.id] ?? null,
            at: new Date(run.createdAt),
            workflowId: run.workflowId,
          })),
        ].sort((a, b) => b.at.getTime() - a.at.getTime())
      : undefined;
  const selected = rows?.find((row) => row.id === search.job);
  useReportView('runs-job', [selected && { kind: JOB_KIND[selected.kind], id: selected.id, label: selected.title }]);

  return (
    <Page title="실행 기록" flush>
      <SplitPane fill="height"
        id="runs" selectionKey={selected?.id}
        defaultWidth="440px"
        pane={selected && <JobCalls key={selected.id} projectId={projectId} job={selected} onClose={() => select(undefined)} />}
      >
        <DataTable id="runs"
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          loading={!rows}
          selected={search.job}
          onRowClick={(row) => (row.kind === 'run' ? void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: row.id } }) : select(row.id === search.job ? undefined : row.id))}
          rowContextMenu={(row) => (
            <>
              <ContextMenuItem
                onClick={() =>
                  row.kind === 'run'
                    ? void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: row.id } })
                    : select(row.id)
                }
              >
                상세
              </ContextMenuItem>
              {row.workflowId && (
                <ContextMenuItem
                  onClick={() =>
                    void navigate({
                      to: '/p/$projectId/workflows/$workflowId',
                      params: { projectId, workflowId: row.workflowId! },
                    })
                  }
                >
                  워크플로 열기
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(row.id);
                  toast.success('ID를 복사했습니다.');
                }}
              >
                ID 복사
              </ContextMenuItem>
            </>
          )}
          empty={<EmptyState noun="실행" />}
        />
      </SplitPane>
    </Page>
  );
}

/** The model requests of one job, newest first. */
function JobCalls({ projectId, job, onClose }: { projectId: string; job: { id: string; kind: keyof typeof JOB_KIND; title: string; stats: Stats | null }; onClose: () => void }) {
  const calls = useQuery(q.aiCalls(projectId, undefined, job.id));
  return (
    <Inspector header={<InspectorHeader kind={JOB_KIND[job.kind]} name={job.title} status={<Text tabular>AI 호출 · 입력/출력 {tokens(job.stats)}</Text>} actions={
        <>
          {job.kind === 'run' && (
            <Button asChild variant="ghost">
              <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: job.id }}>
                실행 상세
              </Link>
            </Button>
          )}
        </>
      } onClose={onClose} />} loading={!calls.data}>
      <Section title={`AI 호출${calls.data ? ` ${calls.data.calls.length.toLocaleString()}` : ''}`}>
      {calls.data?.calls.length === 0 ? (
        <Text as="p" variant="body" tone="muted">이 작업의 AI 호출 기록이 없습니다.</Text>
      ) : (
        <InspectorList>
          {calls.data?.calls.map((call) => (
            <ListItem key={call.id} spaceY="hair" paddingY="cozy" variant="body">
              <Inline gap="condensed">
                <Text minWidth={0} grow truncate>{call.label}</Text>
                {call.status === 'running' ? (
                  <Inline as="span" inline gap="tight" variant="caption">
                    <Spinner size="xs" /> 진행 중
                  </Inline>
                ) : call.status === 'failed' ? (
                  <Text variant="caption" tone="danger">실패</Text>
                ) : (
                  <Text variant="caption" tone="muted">{seconds(call.startedAt, call.finishedAt)}</Text>
                )}
              </Inline>
              <Text as="p" variant="caption" tone="muted" tabular>
                {clock(call.startedAt)} · {call.connectionName ?? '연결 없음'} · {call.model}
                {call.inputTokens != null && ` · 입력 ${call.inputTokens.toLocaleString()}${call.cachedInputTokens ? `(캐시 ${call.cachedInputTokens.toLocaleString()})` : ''} / 출력 ${(call.outputTokens ?? 0).toLocaleString()}`}
              </Text>
              {call.error && <Text as="p" variant="caption" breakWords tone="danger">{call.error}</Text>}
              {(call.hasRequest || call.hasResponse) && <SentRequest projectId={projectId} callId={call.id} hasRequest={call.hasRequest} hasResponse={call.hasResponse} />}
            </ListItem>
          ))}
        </InspectorList>
      )}
      {calls.data && calls.data.calls.length >= 200 && <Text as="p" variant="caption" tone="muted">최근 200건만 보여 줍니다.</Text>}
      </Section>
    </Inspector>
  );
}

/** What a request sent and what a failed one printed, on demand: sizes first, the text when opened (it can be a whole script). */
function SentRequest({ projectId, callId, hasRequest, hasResponse }: { projectId: string; callId: string; hasRequest: boolean; hasResponse: boolean }) {
  const [open, setOpen] = useState(false);
  const request = useQuery({ ...q.aiCallRequest(projectId, callId), enabled: open });
  return (
    <Box asChild paddingTop="tight">
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="inline" flush="start" tone="muted">
          <Icon icon={ChevronRight} turn={open} /> {hasRequest ? (hasResponse ? '입출력' : '보낸 내용') : '받은 출력'}
        </Button>
      </CollapsibleTrigger>
      <Box asChild marginTop="tight" spaceY="condensed">
      <CollapsibleContent>
        {!request.data ? (
          <Skeleton height="placeholder-sm" />
        ) : (
          <>
            {request.data.request != null && <CallText label="보낸 내용" text={request.data.request} />}
            {request.data.response != null && <CallText label="받은 출력" text={request.data.response} />}
          </>
        )}
      </CollapsibleContent>
      </Box>
    </Collapsible>
    </Box>
  );
}

function CallText({ label, text }: { label: string; text: string }) {
  return (
    <Box spaceY="tight">
      <Inline gap="condensed" variant="caption" tone="muted">
        <span>{label}</span>
        <Text tabular>{text.length.toLocaleString()}자 · 약 {Math.round(new TextEncoder().encode(text).length / 4).toLocaleString()} 토큰 (추정)</Text>
        <Button variant="ghost" size="inline" marginLeft="auto" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success(`${label}을 복사했습니다`))}>
          <Copy /> 복사
        </Button>
      </Inline>
      <Box as="pre" maxHeight="scroll-3xl" overflow="auto" radius="md" border="all" background="sunken" padding="condensed" mono variant="caption" breakWords preserveLines>{text}</Box>
    </Box>
  );
}
