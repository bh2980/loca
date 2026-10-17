import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, ChevronRight, CircleAlert, Inbox, MessageSquareQuote, Sparkles, UserRoundSearch, Workflow } from 'lucide-react';
import { GettingStarted } from '@/components/getting-started';
import { JobStatusBadge } from '@/components/job-status';
import { Elapsed, JobProgress } from '@/components/job-progress';
import { Page } from '@/components/page';
import { StatusBar, StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AUTO_MARKS, termMarksOf } from '@tw/shared';
import { q, useReviewTagId } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/p/$projectId/')({ component: Home });

const JOB_KIND = { run: '워크플로', analysis: '작품 분석', terms: '용어집' } as const;

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
  const reviewTag = useReviewTagId(projectId);
  const terms = useQuery(q.terms(projectId));
  const runs = useQuery(q.runs(projectId));
  const workflows = useQuery(q.workflows(projectId));
  // Work analyses and glossary fills run beside workflows; the list shows them together, newest first.
  const jobs = useQuery(q.jobs(projectId));

  const counts = Object.fromEntries(project.data?.byStatus.map((row) => [row.statusId, row.count]) ?? []);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const statusList = statuses.data?.statuses ?? [];
  const finalIds = new Set(statusList.filter((status) => status.kind === 'final').map((status) => status.id));
  const done = Object.entries(counts).reduce((sum, [id, value]) => sum + (finalIds.has(id) ? value : 0), 0);
  const initial = statusList.find((status) => status.kind === 'initial');
  const aiDecided = project.data?.aiDecided;
  const stopped = runs.data?.filter((run) => run.status === 'paused') ?? [];
  const recent = [
    ...(runs.data ?? []).map((run) => ({ kind: 'run' as const, id: run.id, title: run.workflowName, status: run.status, done: (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0), total: run.total, at: new Date(run.createdAt) })),
    ...(jobs.data?.jobs ?? []).map((job) => ({ kind: job.kind, id: job.id, title: job.title, status: job.status, done: job.done ?? 0, total: job.total ?? 1, at: new Date(job.createdAt) })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 5);
  const active = recent.filter((item) => item.status === 'running');

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
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ marks: ['unknownListener'] }} />,
    },
    {
      key: 'rules',
      icon: <MessageSquareQuote />,
      title: '확인 권장 말투 규칙',
      description: '대사가 많은 쌍이거나 근거가 엇갈리는 규칙. 틀리면 많은 줄의 번역이 틀립니다.',
      count: rules.data?.filter((rule) => rule.tags.some((tag) => tag.id === reviewTag)).length ?? 0,
      link: <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', ...(reviewTag && { tags: [reviewTag] }) }} />,
    },
    // What AI decided and nobody has looked at (✦, docs/DESIGN.md 3.5): each count is the #AI가 정함 mark of what its link opens.
    {
      key: 'ai-lines',
      icon: <Sparkles />,
      title: `${AUTO_MARKS.ai.name} 대사`,
      description: '워크플로가 상태를 정하고 아직 사람이 확인하지 않은 줄.',
      count: aiDecided?.lines ?? 0,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ marks: ['ai'] }} />,
    },
    ...(
      [
        ['documents', '문서', { tab: 'documents' }],
        ['characters', '인물', { tab: 'people', display: 'characters' }],
        ['pairs', '관계·말투 규칙', { tab: 'people' }],
        ['events', '사건', { tab: 'events' }],
      ] as const
    ).map(([key, name, where]) => ({
      key: `ai-${key}`,
      icon: <Sparkles />,
      title: `${AUTO_MARKS.ai.name} ${name}`,
      description: key === 'pairs' ? '문맥에 쓰이지만 아직 사람이 확인하지 않은 AI 자료(관계·말투 규칙 항목 수). 표는 쌍으로 묶어 보여 줍니다.' : '문맥에 쓰이지만 아직 사람이 확인하지 않은 AI 자료.',
      count: aiDecided?.knowledge[key] ?? 0,
      link: <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ display: 'table', ...where, marks: ['ai'] }} />,
    })),
    {
      key: 'ai-terms',
      icon: <Sparkles />,
      title: `${AUTO_MARKS.ai.name} 용어`,
      description: '문맥에 쓰이고 있지만 아직 사람이 확인하지 않은 AI 용어.',
      count: aiDecided?.terms ?? 0,
      link: <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ marks: ['ai'] }} />,
    },
    {
      key: 'terms',
      icon: <BookMarked />,
      title: '후보 용어',
      description: '확정해야 번역 문맥에 들어갑니다.',
      count: terms.data?.filter((term) => termMarksOf(term).includes('candidate')).length ?? 0,
      link: <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ marks: ['candidate'] }} />,
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
          <ul className="divide-y rounded-md border border-border/80">
            {open.map((todo) => (
              <li key={todo.key}>
                <TodoRow todo={todo} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-border/80 px-4 py-6 text-xs text-muted-foreground">지금 할 일이 없습니다. 모든 대사가 처리됐고 검토할 것도 없습니다.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-base font-semibold">번역 진행</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            최종 상태 {total ? Math.round((done / total) * 100) : 0}% · 대사 {total.toLocaleString()}개 · 묶음 {project.data?.groupCount.toLocaleString() ?? '–'}개
          </span>
        </div>
        <StatusBar statuses={statusList} counts={counts} className="h-1.5" />
        <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-1">
          {statusList.map((status) => (
            <li key={status.id}>
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ status: status.id }} className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-xs hover:bg-muted/60 transition-colors">
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
          <span className="text-xs text-muted-foreground">{active.length ? `진행 중 ${active.length}개` : '진행 중인 실행이 없습니다.'}</span>
          <Button variant="ghost" size="xs" className="ml-auto text-xs" asChild>
            <Link to="/p/$projectId/runs" params={{ projectId }}>
              실행 기록 <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
        {runs.data?.length === 0 && jobs.data?.jobs.length === 0 ? (
          <p className="rounded-md border border-border/80 px-4 py-6 text-xs text-muted-foreground">아직 실행한 적이 없습니다. 워크플로 {workflows.data?.length ?? 0}개가 준비되어 있습니다.</p>
        ) : (
          <ul className="divide-y rounded-md border border-border/80">
            {recent.map((item) => (
              <li key={item.id}>
                <Link
                  {...(item.kind === 'run' ? { to: '/p/$projectId/runs/$runId', params: { projectId, runId: item.id } } : { to: '/p/$projectId/runs', params: { projectId }, search: { job: item.id } })}
                  className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <span className="w-40 shrink-0 truncate">
                    {item.title !== JOB_KIND[item.kind] && <span className="mr-1.5 text-xs text-muted-foreground">{JOB_KIND[item.kind]}</span>}
                    <span className="font-medium">{item.title}</span>
                  </span>
                  <JobStatusBadge status={item.status} />
                  <JobProgress done={item.done} total={item.total} running={item.status === 'running'} className="min-w-16 flex-1" />
                  <span className="w-24 shrink-0 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                    {item.status === 'running' && item.total <= 1 ? <Elapsed since={item.at} /> : `${item.done.toLocaleString()}/${item.total.toLocaleString()}`}
                  </span>
                  <span className="hidden w-44 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground xl:block">{item.at.toLocaleString()}</span>
                </Link>
              </li>
            ))}
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
