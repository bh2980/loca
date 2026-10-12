import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, History, Inbox, Workflow } from 'lucide-react';
import { Page } from '@/components/page';
import { StatusBar, StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { q } from '@/lib/queries';
import { JobStatusBadge } from '@/components/job-status';

export const Route = createFileRoute('/p/$projectId/')({ component: Dashboard });

function Dashboard() {
  const { projectId } = Route.useParams();
  const project = useQuery(q.project(projectId));
  const statuses = useQuery(q.statuses(projectId));
  const runs = useQuery(q.runs(projectId));
  const workflows = useQuery(q.workflows(projectId));
  // Model requests in flight anywhere in the project (analysis, glossary, chat…), not only runs.
  const calls = useQuery(q.aiCalls(projectId));
  const pending = calls.data?.calls.filter((call) => call.status === 'running') ?? [];

  const counts = Object.fromEntries(project.data?.byStatus.map((row) => [row.statusId, row.count]) ?? []);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const finalIds = new Set(statuses.data?.statuses.filter((status) => status.kind === 'final').map((status) => status.id));
  const done = Object.entries(counts).reduce((sum, [id, value]) => sum + (finalIds.has(id) ? value : 0), 0);
  const active = runs.data?.filter((run) => run.status === 'running' || run.status === 'paused') ?? [];

  return (
    <Page title="개요">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>번역 진행</CardTitle>
            <CardDescription>
              대사 {total.toLocaleString()}개 · 묶음 {project.data?.groupCount.toLocaleString() ?? '–'}개
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">최종 상태</span>
                <span className="font-medium tabular-nums">{total ? Math.round((done / total) * 100) : 0}%</span>
              </div>
              <StatusBar statuses={statuses.data?.statuses ?? []} counts={counts} className="h-2.5" />
            </div>
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {statuses.data?.statuses.map((status) => (
                <li key={status.id}>
                  <Link to="/p/$projectId/script" params={{ projectId }} search={{ status: status.id }} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                    <StatusDot color={status.color} />
                    {status.name}
                    <span className="ml-auto tabular-nums text-muted-foreground">{(counts[status.id] ?? 0).toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>검토함</CardTitle>
            <CardDescription>‘검토함에 표시’가 켜진 상태의 대사</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-3xl font-semibold tabular-nums">{project.data?.reviewCount ?? 0}</p>
            <Button asChild variant="outline" size="sm" disabled={!project.data?.reviewCount}>
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ review: true }}>
                <Inbox /> 검토하러 가기
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>실행</CardTitle>
            <CardDescription>
              {active.length ? `진행 중 ${active.length}개` : '진행 중인 실행이 없습니다.'}
              {pending.length > 0 && ` · AI 호출 진행 중 ${pending.length}건 (${[...new Set(pending.map((call) => call.label))].slice(0, 3).join(', ')})`}
            </CardDescription>
            <CardAction className="flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/p/$projectId/runs" params={{ projectId }} >
                  <History /> 실행 기록
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/p/$projectId/workflows" params={{ projectId }}>
                  <Workflow /> 워크플로 목록
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {runs.data?.slice(0, 6).map((run) => {
                const finished = (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0);
                return (
                  <li key={run.id}>
                    <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className="flex items-center gap-4 py-2.5 text-sm hover:bg-muted/40">
                      <span className="w-40 truncate font-medium">{run.workflowName}</span>
                      <JobStatusBadge status={run.status} />
                      <Progress value={(finished / run.total) * 100} className="h-1.5 flex-1" />
                      <span className="w-24 text-right tabular-nums text-muted-foreground">
                        {finished}/{run.total}
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
              {runs.data?.length === 0 && (
                <li className="py-4 text-sm text-muted-foreground">
                  아직 실행한 적이 없습니다. 워크플로 {workflows.data?.length ?? 0}개가 준비되어 있습니다.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
