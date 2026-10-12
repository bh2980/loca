import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ITEM_STATE } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { SplitPane } from '@/components/split-pane';
import { PaneHeader } from '@/components/pane-header';
import { JobStatusBadge } from '@/components/job-status';

interface RunsSearch {
  /** The run or job whose AI requests the right-hand pane shows. */
  job?: string;
}

export const Route = createFileRoute('/p/$projectId/runs/')({
  validateSearch: (raw: Record<string, unknown>): RunsSearch => ({ job: typeof raw.job === 'string' && raw.job ? raw.job : undefined }),
  component: Runs,
});

const JOB_KIND = { run: '워크플로', analysis: '자료', terms: '용어집', chat: '채팅' } as const;
type Stats = { calls: number | null; inputTokens: number; outputTokens: number };

const seconds = (from: Date | string, to: Date | string | null) => {
  if (!to) return '';
  const total = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return total < 60 ? `${total.toFixed(1)}초` : `${Math.floor(total / 60)}분 ${Math.round(total % 60)}초`;
};
const tokens = (stats: Stats | null | undefined) =>
  stats ? `${stats.calls != null ? `${stats.calls.toLocaleString()}회 · ` : ''}${stats.inputTokens.toLocaleString()} / ${stats.outputTokens.toLocaleString()}` : '—';

/**
 * Everything AI did in the project, one row per job: workflow runs, work analyses, glossary fills
 * and chats, newest first. A row opens its model requests in the right-hand pane.
 */
function Runs() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const runs = useQuery(q.runs(projectId));
  const jobs = useQuery(q.jobs(projectId));
  const select = (id?: string) => void navigate({ search: { job: id }, replace: true });

  const rows = [
    ...(runs.data ?? []).map((run) => {
      const finished = (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0);
      return {
        id: run.id,
        kind: 'run' as const,
        title: run.workflowName,
        sub: `v${run.workflowVersion}`,
        status: <JobStatusBadge status={run.status} />,
        error: run.status === 'paused' ? run.notice : null,
        progress: { done: finished, total: run.total, unit: '줄' },
        result: Object.entries(run.states)
          .map(([state, count]) => `${ITEM_STATE[state as keyof typeof ITEM_STATE] ?? state} ${count}`)
          .join(' · '),
        stats: jobs.data?.runCalls[run.id] ?? null,
        at: new Date(run.createdAt),
      };
    }),
    ...(jobs.data?.jobs ?? []).map((job) => ({
      id: job.id,
      kind: job.kind,
      title: job.title,
      sub: job.profile ?? '',
      status: <JobStatusBadge status={job.status} />,
      error: job.error,
      progress: job.total != null && job.done != null ? { done: job.done, total: job.total, unit: job.kind === 'analysis' ? '부분' : '개' } : null,
      result: seconds(job.createdAt, job.finishedAt),
      stats: job,
      at: new Date(job.createdAt),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const selected = rows.find((row) => row.id === search.job);
  useReportView('runs-job', [selected && { kind: JOB_KIND[selected.kind], id: selected.id, label: selected.title }]);

  return (
    <Page title="실행 기록">
      {runs.data && jobs.data && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>아직 실행이 없습니다</EmptyTitle>
            <EmptyDescription>워크플로 실행, 작품 분석, 용어 AI 채우기, 채팅이 모델을 부르면 여기에 쌓입니다.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <SplitPane
          id="runs"
          defaultWidth="440px"
          className="min-h-0 rounded-lg border"
          pane={
            selected && (
              <div className="h-full">
                <JobCalls key={selected.id} projectId={projectId} job={selected} onClose={() => select(undefined)} />
              </div>
            )
          }
        >
          <div className="min-w-0 flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>작업</TableHead>
                  <TableHead className="w-24">상태</TableHead>
                  <TableHead className="w-56">진행</TableHead>
                  <TableHead className="w-48">결과</TableHead>
                  <TableHead className="w-44">AI 호출 · 입력/출력</TableHead>
                  <TableHead className="w-44">시작</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-state={row.id === search.job ? 'selected' : undefined} className="cursor-pointer" onClick={() => select(row.id === search.job ? undefined : row.id)}>
                    <TableCell>
                      <span className="mr-1.5 text-xs text-muted-foreground">{JOB_KIND[row.kind]}</span>
                      <span className="font-medium">{row.title}</span>
                      {row.sub && <span className="ml-1.5 text-xs text-muted-foreground">{row.sub}</span>}
                    </TableCell>
                    <TableCell>
                      {row.status}
                      {row.error && (
                        <p className="mt-1 max-w-56 truncate text-xs text-destructive" title={row.error}>
                          {row.error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.progress ? (
                        <div className="flex items-center gap-3">
                          <Progress value={row.progress.total ? (row.progress.done / row.progress.total) * 100 : 0} className="h-1.5" />
                          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {row.progress.done}/{row.progress.total}
                            {row.progress.unit}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.result}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{tokens(row.stats)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.at.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SplitPane>
      )}
    </Page>
  );
}

/** The model requests of one job, newest first. */
function JobCalls({ projectId, job, onClose }: { projectId: string; job: { id: string; kind: keyof typeof JOB_KIND; title: string; stats: Stats | null }; onClose: () => void }) {
  const calls = useQuery(q.aiCalls(projectId, undefined, job.id));
  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        kicker={JOB_KIND[job.kind]}
        title={job.title}
        subtitle={<span className="tabular-nums">AI 호출 · 입력/출력 {tokens(job.stats)}</span>}
        actions={
          <>
            {job.kind === 'run' && (
              <Button asChild size="sm" variant="outline">
                <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: job.id }}>
                  실행 상세
                </Link>
              </Button>
            )}
            {job.kind === 'analysis' && (
              <Button asChild size="sm" variant="outline">
                <Link to="/p/$projectId/knowledge" params={{ projectId }}>
                  자료 보기
                </Link>
              </Button>
            )}
            {job.kind === 'terms' && (
              <Button asChild size="sm" variant="outline">
                <Link to="/p/$projectId/glossary" params={{ projectId }}>
                  용어집 보기
                </Link>
              </Button>
            )}
          </>
        }
        onClose={onClose}
      />
      <ScrollArea className="min-h-0 flex-1">
        {calls.data?.calls.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">이 작업의 AI 호출 기록이 없습니다. 호출 기록이 생기기 전에 돈 작업은 합계만 남아 있습니다.</p>
        ) : (
          <ul className="divide-y">
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
                  {new Date(call.startedAt).toLocaleTimeString()} · {call.profileName ?? '프로필 없음'} · {call.model}
                  {call.inputTokens != null && ` · 입력 ${call.inputTokens.toLocaleString()}${call.cachedInputTokens ? `(캐시 ${call.cachedInputTokens.toLocaleString()})` : ''} / 출력 ${(call.outputTokens ?? 0).toLocaleString()}`}
                </p>
                {call.error && <p className="text-xs break-words text-destructive">{call.error}</p>}
              </li>
            ))}
          </ul>
        )}
        {calls.data && calls.data.calls.length >= 200 && <p className="px-4 py-2 text-xs text-muted-foreground">최근 200건만 보여 줍니다.</p>}
      </ScrollArea>
    </div>
  );
}
