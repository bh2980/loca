import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/components/page';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ITEM_STATE, RUN_STATUS } from '@/lib/labels';
import { q } from '@/lib/queries';

type CallKind = 'run' | 'analysis' | 'terms' | 'test' | 'chat';
const CALL_KINDS: Record<CallKind, string> = { run: '워크플로', analysis: '작품 분석', terms: '용어', chat: '채팅', test: '프로필 시험' };

interface RunsSearch {
  /** "calls": every AI request of the project instead of workflow runs. */
  view?: 'calls';
  kind?: CallKind;
  /** Only the requests of one run or job. */
  ref?: string;
}

export const Route = createFileRoute('/p/$projectId/runs/')({
  validateSearch: (raw: Record<string, unknown>): RunsSearch => ({
    view: raw.view === 'calls' ? 'calls' : undefined,
    kind: typeof raw.kind === 'string' && raw.kind in CALL_KINDS ? (raw.kind as CallKind) : undefined,
    ref: typeof raw.ref === 'string' && raw.ref ? raw.ref : undefined,
  }),
  component: Runs,
});

function Runs() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Page title="실행 기록">
      <Tabs value={search.view ?? 'runs'} onValueChange={(value) => void navigate({ search: value === 'calls' ? { view: 'calls' } : {} })} className="mb-4">
        <TabsList>
          <TabsTrigger value="runs">작업</TabsTrigger>
          <TabsTrigger value="calls">AI 호출</TabsTrigger>
        </TabsList>
      </Tabs>
      {search.view === 'calls' ? <Calls /> : <RunList />}
    </Page>
  );
}

const JOB_STATUS = { running: '실행 중', completed: '완료', failed: '실패', cancelled: '취소됨' } as const;

/** Workflow runs, work analyses and glossary fills in one list, newest first. */
function RunList() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const runs = useQuery(q.runs(projectId));
  const jobs = useQuery(q.jobs(projectId));
  const rows = [
    ...(runs.data ?? []).map((run) => ({ kind: 'run' as const, at: new Date(run.createdAt).getTime(), run })),
    ...(jobs.data?.jobs ?? []).map((job) => ({ kind: job.kind, at: new Date(job.createdAt).getTime(), job })),
  ].sort((a, b) => b.at - a.at);
  const calls = (id: string, stats?: { calls: number | null; inputTokens: number; outputTokens: number } | null) =>
    stats ? (
      <Link to="/p/$projectId/runs" params={{ projectId }} search={{ view: 'calls', ref: id }} className="text-xs text-muted-foreground tabular-nums hover:underline" onClick={(event) => event.stopPropagation()}>
        {stats.calls != null ? `${stats.calls.toLocaleString()}회 · ` : ''}
        {stats.inputTokens.toLocaleString()} / {stats.outputTokens.toLocaleString()}
      </Link>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );

  return (
    <>
      {runs.data && jobs.data && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>아직 실행이 없습니다</EmptyTitle>
            <EmptyDescription>워크플로 실행, 작품 분석, 용어 AI 채우기가 여기에 쌓입니다.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>작업</TableHead>
                <TableHead className="w-24">상태</TableHead>
                <TableHead className="w-64">진행</TableHead>
                <TableHead className="w-56">결과</TableHead>
                <TableHead className="w-40">AI 호출 · 입력/출력</TableHead>
                <TableHead className="w-44">시작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                if (row.kind === 'run') {
                  const run = row.run;
                  const finished = (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0);
                  return (
                    <TableRow key={run.id} className="cursor-pointer" onClick={() => void navigate({ to: '/p/$projectId/runs/$runId', params: { projectId, runId: run.id } })}>
                      <TableCell>
                        <span className="mr-1.5 text-xs text-muted-foreground">워크플로</span>
                        <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                          {run.workflowName}
                        </Link>
                        <span className="ml-1.5 text-xs text-muted-foreground">v{run.workflowVersion}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={run.status === 'running' ? 'default' : 'outline'}>{RUN_STATUS[run.status]}</Badge>
                        {run.status === 'paused' && run.notice && (
                          <p className="mt-1 max-w-56 truncate text-xs text-destructive" title={run.notice}>
                            {run.notice}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Progress value={(finished / run.total) * 100} className="h-1.5" />
                          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {finished}/{run.total}줄
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Object.entries(run.states)
                          .map(([state, count]) => `${ITEM_STATE[state as keyof typeof ITEM_STATE] ?? state} ${count}`)
                          .join(' · ')}
                      </TableCell>
                      <TableCell>{calls(run.id, jobs.data?.runCalls[run.id])}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  );
                }
                const job = row.job;
                const open = () => void navigate(job.kind === 'analysis' ? { to: '/p/$projectId/knowledge', params: { projectId } } : { to: '/p/$projectId/glossary', params: { projectId } });
                return (
                  <TableRow key={job.id} className="cursor-pointer" onClick={open}>
                    <TableCell>
                      <span className="mr-1.5 text-xs text-muted-foreground">{job.kind === 'analysis' ? '자료' : '용어집'}</span>
                      <span className="font-medium">{job.title}</span>
                      {job.profile && <span className="ml-1.5 text-xs text-muted-foreground">{job.profile}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={job.status === 'running' ? 'default' : 'outline'}>{JOB_STATUS[job.status]}</Badge>
                      {job.error && (
                        <p className="mt-1 max-w-56 truncate text-xs text-destructive" title={job.error}>
                          {job.error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={job.total ? (job.done / job.total) * 100 : 0} className="h-1.5" />
                        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {job.done}/{job.total}
                          {job.kind === 'analysis' ? '부분' : '개'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{job.finishedAt ? seconds(job.createdAt, job.finishedAt) : ''}</TableCell>
                    <TableCell>{calls(job.id, job)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

const count = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString());
const seconds = (from: Date | string, to: Date | string | null) => (to ? `${((new Date(to).getTime() - new Date(from).getTime()) / 1000).toFixed(1)}초` : '');

/** Every model request of the project, newest first: what it was for, which model, tokens, time. */
function Calls() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const calls = useQuery(q.aiCalls(projectId, search.kind, search.ref));
  const totals = calls.data?.totals ?? [];
  const sum = (pick: (row: (typeof totals)[number]) => number) => totals.reduce((total, row) => total + (pick(row) ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={search.kind ?? 'all'}
          onValueChange={(value) => value && void navigate({ search: { view: 'calls', ref: search.ref, kind: value === 'all' ? undefined : (value as CallKind) }, replace: true })}
        >
          <ToggleGroupItem value="all">전체</ToggleGroupItem>
          {(Object.keys(CALL_KINDS) as CallKind[]).map((kind) => (
            <ToggleGroupItem key={kind} value={kind}>
              {CALL_KINDS[kind]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {search.ref && (
          <Button size="sm" variant="secondary" className="h-7" onClick={() => void navigate({ search: { view: 'calls', kind: search.kind }, replace: true })}>
            작업 하나만 보는 중 · 전체 보기
          </Button>
        )}
        <p className="text-sm text-muted-foreground tabular-nums">
          호출 {sum((row) => row.calls).toLocaleString()}회{sum((row) => row.running) ? ` · 진행 중 ${sum((row) => row.running).toLocaleString()}` : ''}
          {sum((row) => row.failed) ? ` · 실패 ${sum((row) => row.failed).toLocaleString()}` : ''} · 입력 {sum((row) => row.inputTokens).toLocaleString()} · 출력 {sum((row) => row.outputTokens).toLocaleString()} 토큰
        </p>
      </div>
      {calls.data?.calls.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>아직 AI 호출이 없습니다</EmptyTitle>
            <EmptyDescription>워크플로 실행, 작품 분석, 용어 AI 채우기, 채팅이 모델을 부르면 여기에 쌓입니다.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">시작</TableHead>
                <TableHead>무엇</TableHead>
                <TableHead>프로필 · 모델</TableHead>
                <TableHead className="w-24 text-right">입력</TableHead>
                <TableHead className="w-24 text-right">출력</TableHead>
                <TableHead className="w-20 text-right">시간</TableHead>
                <TableHead className="w-24">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.data?.calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">{new Date(call.startedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <span className="mr-1.5 text-xs text-muted-foreground">{CALL_KINDS[call.kind]}</span>
                    {call.kind === 'run' && call.refId ? (
                      <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: call.refId }} className="hover:underline">
                        {call.label}
                      </Link>
                    ) : call.kind === 'analysis' ? (
                      <Link to="/p/$projectId/knowledge" params={{ projectId }} className="hover:underline">
                        {call.label}
                      </Link>
                    ) : (
                      call.label
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {call.profileName ?? <span className="text-muted-foreground">프로필 없음</span>}
                    <span className="ml-1.5 text-xs text-muted-foreground">{call.model}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(call.inputTokens)}
                    {!!call.cachedInputTokens && <span className="block text-xs text-muted-foreground">캐시 {call.cachedInputTokens.toLocaleString()}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{count(call.outputTokens)}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{seconds(call.startedAt, call.finishedAt)}</TableCell>
                  <TableCell>
                    {call.status === 'running' ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Spinner className="size-3.5" /> 진행 중
                      </span>
                    ) : call.status === 'failed' ? (
                      <span className="text-sm text-destructive">
                        실패
                        {call.error && (
                          <span className="block max-w-56 truncate text-xs" title={call.error}>
                            {call.error}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">완료</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {calls.data && calls.data.calls.length >= 200 && <p className="text-xs text-muted-foreground">최근 200건만 보여 줍니다.</p>}
    </div>
  );
}
