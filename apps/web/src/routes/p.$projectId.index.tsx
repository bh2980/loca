import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, ChevronRight, CircleAlert, Inbox, MessageSquareQuote, UserRoundSearch, Workflow } from 'lucide-react';
import { GettingStarted } from '@/components/getting-started';
import { JobStatusBadge } from '@/components/job-status';
import { Page } from '@/components/page';
import { StatusBar, StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/p/$projectId/')({ component: Home });

interface Todo {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
  /** Something is wrong (a run stopped), not just waiting. */
  alert?: boolean;
  /** The destination, already filtered; the row is rendered inside it. */
  link: ReactElement<{ className?: string; children?: ReactNode }>;
}

/**
 * What to do next in this project, then how far the translation is and what is running. Every
 * to-do opens the screen already filtered to exactly those items.
 */
function Home() {
  const { projectId } = Route.useParams();
  const project = useQuery(q.project(projectId));
  const statuses = useQuery(q.statuses(projectId));
  const groups = useQuery(q.groups(projectId));
  const rules = useQuery(q.speechRules(projectId));
  const terms = useQuery(q.terms(projectId));
  const runs = useQuery(q.runs(projectId));
  const workflows = useQuery(q.workflows(projectId));

  const counts = Object.fromEntries(project.data?.byStatus.map((row) => [row.statusId, row.count]) ?? []);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const statusList = statuses.data?.statuses ?? [];
  const finalIds = new Set(statusList.filter((status) => status.kind === 'final').map((status) => status.id));
  const done = Object.entries(counts).reduce((sum, [id, value]) => sum + (finalIds.has(id) ? value : 0), 0);
  const initial = statusList.find((status) => status.kind === 'initial');
  const stopped = runs.data?.filter((run) => run.status === 'paused') ?? [];
  const active = runs.data?.filter((run) => run.status === 'running') ?? [];

  const todos: Todo[] = [
    {
      key: 'review',
      icon: <Inbox />,
      title: '검토함',
      description: '‘검토함에 표시’ 상태의 대사. 번역을 확인하고 다음 상태로 옮기세요.',
      count: project.data?.reviewCount ?? 0,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ review: true }} />,
    },
    {
      key: 'stopped',
      icon: <CircleAlert />,
      title: '멈춘 실행',
      description: stopped[0]?.notice ?? '실행이 스스로 일시정지했습니다. 이유를 보고 이어서 실행하세요.',
      count: stopped.length,
      alert: true,
      link: stopped.length === 1 ? <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: stopped[0].id }} /> : <Link to="/p/$projectId/runs" params={{ projectId }} />,
    },
    {
      key: 'listener',
      icon: <UserRoundSearch />,
      title: '청자 미상 대사',
      description: '누구에게 하는 말인지 모르면 말투 규칙을 쓸 수 없습니다. 대사 패널에서 고르거나 청자 추정 워크플로를 돌리세요.',
      count: groups.data?.reduce((sum, group) => sum + group.unknownListeners, 0) ?? 0,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ listener: '-' }} />,
    },
    {
      key: 'rules',
      icon: <MessageSquareQuote />,
      title: '확인 권장 말투 규칙',
      description: '대사가 많은 쌍이거나 근거가 엇갈리는 규칙. 틀리면 많은 줄의 번역이 틀립니다.',
      count: rules.data?.filter((rule) => rule.review && !rule.reviewed).length ?? 0,
      link: <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table' }} />,
    },
    {
      key: 'terms',
      icon: <BookMarked />,
      title: '후보 용어',
      description: '확정해야 번역 문맥에 들어갑니다.',
      count: terms.data?.filter((term) => term.status === 'candidate').length ?? 0,
      link: <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ state: 'candidate' } as never} />,
    },
    {
      key: 'untranslated',
      icon: <Workflow />,
      title: `${initial?.name ?? '미번역'} 대사`,
      description: '워크플로로 번역을 시작하세요. 대사 화면에서 묶음이나 대사를 골라 실행합니다.',
      count: initial ? (counts[initial.id] ?? 0) : 0,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ status: initial?.id }} />,
    },
  ];
  const loading = !project.data || !runs.data || !groups.data || !rules.data || !terms.data;
  const open = todos.filter((todo) => todo.count > 0);

  return (
    <Page title="홈" className="mx-auto w-full max-w-5xl space-y-8 py-8">
      <GettingStarted projectId={projectId} />
      <section>
        <h2 className="mb-3 text-base font-semibold">다음 할 일</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : open.length ? (
          <ul className="divide-y rounded-lg border">
            {open.map((todo) => (
              <li key={todo.key}>
                <TodoRow todo={todo} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border px-4 py-6 text-sm text-muted-foreground">지금 할 일이 없습니다. 모든 대사가 처리됐고 검토할 것도 없습니다.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-base font-semibold">번역 진행</h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            최종 상태 {total ? Math.round((done / total) * 100) : 0}% · 대사 {total.toLocaleString()}개 · 묶음 {project.data?.groupCount.toLocaleString() ?? '–'}개
          </span>
        </div>
        <StatusBar statuses={statusList} counts={counts} className="h-2" />
        <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-1">
          {statusList.map((status) => (
            <li key={status.id}>
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ status: status.id }} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                <StatusDot color={status.color} />
                {status.name}
                <span className="text-muted-foreground tabular-nums">{(counts[status.id] ?? 0).toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-base font-semibold">실행</h2>
          <span className="text-sm text-muted-foreground">{active.length ? `진행 중 ${active.length}개` : '진행 중인 실행이 없습니다.'}</span>
          <Button variant="ghost" className="ml-auto" asChild>
            <Link to="/p/$projectId/runs" params={{ projectId }}>
              실행 기록 <ChevronRight />
            </Link>
          </Button>
        </div>
        {runs.data?.length === 0 ? (
          <p className="rounded-lg border px-4 py-6 text-sm text-muted-foreground">아직 실행한 적이 없습니다. 워크플로 {workflows.data?.length ?? 0}개가 준비되어 있습니다.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {runs.data?.slice(0, 5).map((run) => {
              const finished = (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0);
              return (
                <li key={run.id}>
                  <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-muted/50">
                    <span className="w-48 truncate font-medium">{run.workflowName}</span>
                    <JobStatusBadge status={run.status} />
                    <Progress value={run.total ? (finished / run.total) * 100 : 0} className="h-1.5 flex-1" />
                    <span className="w-24 text-right text-muted-foreground tabular-nums">
                      {finished.toLocaleString()}/{run.total.toLocaleString()}
                    </span>
                    <span className="w-44 text-right text-xs whitespace-nowrap text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Page>
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const content = (
    <>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md bg-muted [&_svg]:size-4', todo.alert && 'bg-destructive/10 text-destructive')}>{todo.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{todo.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{todo.description}</span>
      </span>
      <span className={cn('text-base font-semibold tabular-nums', todo.alert && 'text-destructive')}>{todo.count.toLocaleString()}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </>
  );
  return cloneElement(todo.link, { className: 'flex items-center gap-4 px-4 py-3 hover:bg-muted/50', children: content });
}
