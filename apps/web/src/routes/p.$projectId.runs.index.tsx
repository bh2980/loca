import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/components/page';
import { InspectorHeader, Inspector, SplitPane, EmptyState, DataTable, type ColumnDef, JobStatusBadge, Button, Progress, Spinner, Collapsible, CollapsibleContent, CollapsibleTrigger, Skeleton, ContextMenuItem } from '@loca/ui';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { cn } from '@/lib/utils';
import { dateTime, clock } from '@/lib/datetime';

interface RunsSearch {
  /** The run or job whose AI requests the right-hand pane shows. */
  job?: string;
}

export const Route = createFileRoute('/p/$projectId/runs/')({
  validateSearch: (raw: Record<string, unknown>): RunsSearch => ({ job: typeof raw.job === 'string' && raw.job ? raw.job : undefined }),
  component: Runs,
});

const JOB_KIND = { run: '워크플로', terms: '용어집' } as const;
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
  status: Parameters<typeof JobStatusBadge>[0]['status'];
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
        <span className="mr-1 text-xs text-muted-foreground">{JOB_KIND[row.original.kind]}</span>{' '}
        <span className="font-medium">{row.original.title}</span>
        {row.original.sub && (
          <>
            {' '}
            <span className="ml-1 text-xs text-muted-foreground">{row.original.sub}</span>
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
        <JobStatusBadge status={row.original.status} />
        {row.original.error && (
          <p className="mt-1 truncate text-xs text-destructive" title={row.original.error}>
            {row.original.error}
          </p>
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
      if (!progress) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <div className="flex items-center gap-3">
          <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} className="h-1.5" />
          <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {progress.done.toLocaleString()}/{progress.total.toLocaleString()}
            {progress.unit}
          </span>
        </div>
      );
    },
  },
  { id: 'stats', header: 'AI 호출·토큰', meta: { width: 160, align: 'end', className: 'text-xs text-muted-foreground' }, cell: ({ row }) => tokens(row.original.stats) },
  { id: 'at', header: '시작', meta: { width: 150, className: 'text-xs text-muted-foreground' }, cell: ({ row }) => startedAt(row.original.at) },
];


/**
 * Everything AI did in the project, one row per job: workflow runs, work analyses, glossary fills,
 * newest first. A workflow run opens its detail page; other jobs open their model requests in the right-hand pane.
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
            progress: { done: (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0), total: run.total, unit: '줄' },
            stats: jobs.data.runCalls[run.id] ?? null,
            at: new Date(run.createdAt),
            workflowId: run.workflowId,
          })),
          ...jobs.data.jobs.map((job) => ({
            id: job.id,
            kind: job.kind,
            title: job.title,
            sub: job.model ?? '',
            status: job.status,
            error: job.error,
            progress: job.total != null && job.done != null ? { done: job.done, total: job.total, unit: '개' } : null,
            stats: job,
            at: new Date(job.createdAt),
          })),
        ].sort((a, b) => b.at.getTime() - a.at.getTime())
      : undefined;
  const selected = rows?.find((row) => row.id === search.job);
  useReportView('runs-job', [selected && { kind: JOB_KIND[selected.kind], id: selected.id, label: selected.title }]);

  return (
    <Page title="실행 기록" flush>
      <SplitPane
        id="runs" selectionKey={selected?.id}
        defaultWidth="440px"
        className="h-full"
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
    <Inspector header={<InspectorHeader kind={JOB_KIND[job.kind]} name={job.title} status={<span className="tabular-nums">AI 호출 · 입력/출력 {tokens(job.stats)}</span>} actions={
        <>
          {job.kind === 'run' && (
            <Button asChild variant="ghost">
              <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: job.id }}>
                실행 상세
              </Link>
            </Button>
          )}
          {job.kind === 'terms' && (
            <Button asChild variant="ghost">
              <Link to="/p/$projectId/glossary" params={{ projectId }}>
                용어집 보기
              </Link>
            </Button>
          )}
        </>
      } onClose={onClose} />} loading={!calls.data} bodyClassName="space-y-0 p-0">
      {calls.data?.calls.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">이 작업의 AI 호출 기록이 없습니다.</p>
      ) : (
        <ul>
          {calls.data?.calls.map((call) => (
            <li key={call.id} className="space-y-0.5 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{call.label}</span>
                {call.status === 'running' ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Spinner className="size-3" /> 진행 중
                  </span>
                ) : call.status === 'failed' ? (
                  <span className="text-xs text-destructive">실패</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{seconds(call.startedAt, call.finishedAt)}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {clock(call.startedAt)} · {call.connectionName ?? '연결 없음'} · {call.model}
                {call.inputTokens != null && ` · 입력 ${call.inputTokens.toLocaleString()}${call.cachedInputTokens ? `(캐시 ${call.cachedInputTokens.toLocaleString()})` : ''} / 출력 ${(call.outputTokens ?? 0).toLocaleString()}`}
              </p>
              {call.error && <p className="text-xs break-words text-destructive">{call.error}</p>}
              {(call.hasRequest || call.hasResponse) && <SentRequest projectId={projectId} callId={call.id} hasRequest={call.hasRequest} hasResponse={call.hasResponse} />}
            </li>
          ))}
        </ul>
      )}
      {calls.data && calls.data.calls.length >= 200 && <p className="px-4 py-2 text-xs text-muted-foreground">최근 200건만 보여 줍니다.</p>}
    </Inspector>
  );
}

/** What a request sent and what a failed one printed, on demand: sizes first, the text when opened (it can be a whole script). */
function SentRequest({ projectId, callId, hasRequest, hasResponse }: { projectId: string; callId: string; hasRequest: boolean; hasResponse: boolean }) {
  const [open, setOpen] = useState(false);
  const request = useQuery({ ...q.aiCallRequest(projectId, callId), enabled: open });
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="pt-1">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="inline" className="-ml-1 text-muted-foreground">
          <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> {hasRequest ? (hasResponse ? '입출력' : '보낸 내용') : '받은 출력'}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-2">
        {!request.data ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            {request.data.request != null && <CallText label="보낸 내용" text={request.data.request} />}
            {request.data.response != null && <CallText label="받은 출력" text={request.data.response} />}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CallText({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{text.length.toLocaleString()}자 · 약 {Math.round(new TextEncoder().encode(text).length / 4).toLocaleString()} 토큰 (추정)</span>
        <Button variant="ghost" size="inline" className="ml-auto" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success(`${label}을 복사했습니다`))}>
          <Copy /> 복사
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap">{text}</pre>
    </div>
  );
}
