import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { BookMarked, ChevronRight, CircleAlert, Inbox, MessageSquareQuote, Sparkles, UserRoundSearch, Workflow } from 'lucide-react';
import { GettingStarted } from '@/components/getting-started';
import { RunStatusBadge, Box, Button, Heading, Icon, Inline, ListRow, Stack, StatusChipLink, StatusIcon, Meter, Text, TodoIcon, Skeleton } from '@loca/ui';
import { Elapsed, JobProgress } from '@/components/job-progress';
import { Page } from '@/components/page';
import { AUTO_MARKS, markName } from '@tw/shared';
import { q, useMarkStyles } from '@/lib/queries';
import { dateTime } from '@/lib/datetime';
import { useProgress } from '@/lib/use-progress';
import { SCRIPT_VIEW } from '@/lib/labels';
import { useTerms } from '@/lib/terms';
import { useSpeechRules } from '@/lib/knowledge';
import { useGroups } from '@/lib/groups';

export const Route = createFileRoute('/p/$projectId/')({ component: Home });

const JOB_KIND = { run: '워크플로' } as const;
const SCRIPT_KINDS = ['scene', 'ui', 'document'] as const;
const LINE_KIND_LABEL = { scene: '대사', ui: 'UI 문자열', document: '문서' } as const;

interface Todo {
  key: string;
  icon: ReactNode;
  title: string;
  description?: string;
  count: number;
  /** Something is wrong (a run stopped), not just waiting. */
  alert?: boolean;
  /** The destination, already filtered; the row is rendered inside it. */
  link: ReactElement<{ children?: ReactNode }>;
}

/**
 * What to do next in this project, then how far the translation is and what is running. Every
 * to-do opens the screen already filtered to exactly those items.
 */
function Home() {
  const { projectId } = Route.useParams();
  const project = useQuery(q.project(projectId));
  const markStyles = useMarkStyles(projectId);
  const progress = useProgress(projectId);
  const groups = useGroups(projectId);
  // Counted as the linked list shows them: status set by AI, 번역 제외 hidden.
  const aiLineCounts = useQueries({ queries: SCRIPT_KINDS.map((kind) => q.units(projectId, { kind, decidedBy: 'ai', excluded: 'hide', limit: 1 })) });
  const rules = useSpeechRules(projectId);
  const terms = useTerms(projectId);
  const runs = useQuery(q.runs(projectId));

  const { counts, total, done, statuses: statusList } = progress;
  const initial = statusList.find((status) => status.kind === 'initial');
  const kindProgress = SCRIPT_KINDS.map((kind) => {
    const kindGroups = (groups.data ?? []).filter((group) => group.kind === kind);
    const statusCounts = Object.fromEntries(statusList.map((status) => [status.id, kindGroups.reduce((sum, group) => sum + (group.statuses[status.id] ?? 0), 0)]));
    return { kind, groups: kindGroups.length, lines: kindGroups.reduce((sum, group) => sum + group.total, 0), statusCounts };
  }).filter((row) => row.groups > 0);
  const aiLinesByKind = SCRIPT_KINDS.map((kind, index) => ({ kind, count: aiLineCounts[index]?.data?.total ?? 0 }));
  const aiDecided = project.data?.aiDecided;
  const stopped = runs.data?.filter((run) => run.status === 'paused') ?? [];
  const recent = [
    ...(runs.data ?? []).map((run) => ({ kind: 'run' as const, id: run.id, title: run.workflowName, status: run.status, done: (run.states.done ?? 0) + (run.states.failed ?? 0) + (run.states.cancelled ?? 0), total: run.total, at: new Date(run.createdAt) })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 5);
  const active = recent.filter((item) => item.status === 'running');

  const todos: Todo[] = [
    {
      key: 'review',
      icon: <Inbox />,
      title: '검토함',
      count: project.data?.reviewCount ?? 0,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ review: true }} />,
    },
    {
      key: 'stopped',
      icon: <CircleAlert />,
      title: '멈춘 실행',
      description: stopped[0]?.notice ?? undefined,
      count: stopped.length,
      alert: true,
      link: stopped.length === 1 ? <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: stopped[0].id }} /> : <Link to="/p/$projectId/runs" params={{ projectId }} />,
    },
    {
      key: 'listener',
      icon: <UserRoundSearch />,
      title: '청자 모름',
      count: groups.data?.reduce((sum, group) => sum + group.unknownListeners, 0) ?? 0,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ listener: '-' }} />,
    },
    {
      key: 'rules',
      icon: <MessageSquareQuote />,
      title: '확인 권장 말투 규칙',
      count: rules.data?.filter((rule) => rule.reviewNote).length ?? 0,
      link: <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'table', marks: ['review'] }} />,
    },
    // The script opens one kind at a time, so these marks use the same per-kind rows as status progress.
    ...aiLinesByKind.map(({ kind, count }) => ({
      key: `ai-lines-${kind}`,
      icon: <Sparkles />,
      title: `AI가 정한 ${LINE_KIND_LABEL[kind]} 확인 전`,
      count,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ kind, decidedBy: 'ai' }} />,
    })),
    ...(
      [
        ['characters', '인물', { tab: 'people', display: 'characters' }],
        ['pairs', '관계·말투 규칙', { tab: 'people' }],
        ['events', '사건', { tab: 'events' }],
        ['documents', '노트', { tab: 'documents' }],
      ] as const
    ).map(([key, name, where]) => ({
      key: `ai-${key}`,
      icon: <Sparkles />,
      title: `AI가 정한 ${name} 확인 전`,
      count: aiDecided?.knowledge[key] ?? 0,
      link: <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ display: 'table', ...where, decidedBy: 'ai' }} />,
    })),
    {
      key: 'ai-terms',
      icon: <Sparkles />,
      title: 'AI가 정한 용어 확인 전',
      count: aiDecided?.terms ?? 0,
      link: <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ decidedBy: 'ai' }} />,
    },
    {
      key: 'terms',
      icon: <BookMarked />,
      title: '용어 후보',
      count: terms.data?.filter((term) => term.status === 'candidate').length ?? 0,
      link: <Link to="/p/$projectId/glossary" params={{ projectId }} search={{ status: 'candidate' }} />,
    },
    ...kindProgress.map(({ kind, statusCounts }) => ({
      key: `untranslated-${kind}`,
      icon: <Workflow />,
      title: `${initial?.name ?? '미번역'} ${LINE_KIND_LABEL[kind]}`,
      count: initial ? statusCounts[initial.id] ?? 0 : 0,
      link: <Link to="/p/$projectId/script" params={{ projectId }} search={{ kind, statuses: initial ? [initial.id] : undefined, mode: 'find' }} />,
    })),
  ];
  const loading = !project.data || !runs.data || !groups.data || !rules.data || !terms.data || aiLineCounts.some((query) => !query.data);
  const open = todos.filter((todo) => todo.count > 0);

  return (
    <Page title="홈" reading>
      <GettingStarted projectId={projectId} />
      <section>
        <Heading variant="page-section" minWidth={0} marginBottom="normal">다음 할 일</Heading>
        {loading ? (
          <Box spaceY="condensed">
            <Skeleton height="placeholder-sm" count={2} />
          </Box>
        ) : open.length ? (
          <Box as="ul" radius="md" border="all">
            {open.map((todo) => (
              <li key={todo.key}>
                <TodoRow todo={todo} />
              </li>
            ))}
          </Box>
        ) : (
          <Text as="p" radius="md" border="all" paddingX="comfortable" paddingY="spacious" variant="body" tone="muted">지금 할 일이 없습니다.</Text>
        )}
      </section>

      <section>
        <Stack direction="row" align="baseline" gap="normal" marginBottom="normal">
          <Heading variant="page-section" minWidth={0}>번역 진행</Heading>
          <Text variant="caption" tone="muted" tabular>
            최종 상태 {total ? Math.round((done / total) * 100) : 0}% · 대사 {total.toLocaleString()}개 · 묶음 {project.data?.groupCount.toLocaleString() ?? '–'}개
          </Text>
        </Stack>
        <Meter size="md" statuses={statusList} counts={counts} />
        <Box as="ul" marginTop="normal" spaceY="condensed">
          {kindProgress.map(({ kind, statusCounts, lines }) => (
            <Inline as="li" key={kind} wrap gapX="normal" gapY="tight">
              <Text variant="caption" tone="muted" minWidth="field-xs">{SCRIPT_VIEW[kind]} · {lines.toLocaleString()}줄</Text>
              <Stack as="ul" direction="row" wrap gapX="tight" gapY="tight">
                {statusList.map((status) => (
                  <li key={status.id}>
                    <StatusChipLink>
                      <Link to="/p/$projectId/script" params={{ projectId }} search={{ kind, statuses: [status.id], mode: 'find' }}>
                        <StatusIcon status={status} />
                        {status.name}
                        <Text variant="caption" tone="muted" tabular>{(statusCounts[status.id] ?? 0).toLocaleString()}</Text>
                      </Link>
                    </StatusChipLink>
                  </li>
                ))}
              </Stack>
            </Inline>
          ))}
        </Box>
      </section>

      <section>
        <Inline gap="normal" marginBottom="normal">
          <Heading variant="page-section" minWidth={0}>실행</Heading>
          <Text variant="caption" tone="muted">{active.length ? `진행 중 ${active.length}개` : '진행 중인 실행이 없습니다.'}</Text>
          <Button variant="ghost" marginLeft="auto" asChild>
            <Link to="/p/$projectId/runs" params={{ projectId }}>
              실행 기록 <Icon icon={ChevronRight} size="sm" />
            </Link>
          </Button>
        </Inline>
        {runs.data?.length === 0 ? (
          <Text as="p" radius="md" border="all" paddingX="comfortable" paddingY="spacious" variant="body" tone="muted">아직 실행한 적이 없습니다.</Text>
        ) : (
          <Box as="ul" radius="md" border="all">
            {recent.map((item) => (
              <li key={item.id}>
                <ListRow as="link" variant="bordered" size="sm">
                  <Link
                    {...(item.kind === 'run' ? { to: '/p/$projectId/runs/$runId', params: { projectId, runId: item.id } } : { to: '/p/$projectId/runs', params: { projectId }, search: { job: item.id } })}
                  >
                    <Text width="field-lg" shrink={false} truncate>
                      {item.title !== JOB_KIND[item.kind] && <><Text variant="caption" tone="muted" marginRight="tight">{JOB_KIND[item.kind]}</Text>{' '}</>}
                      <Text weight="medium">{item.title}</Text>
                    </Text>{' '}
                    <RunStatusBadge status={item.status} />{' '}
                    <JobProgress done={item.done} total={item.total} running={item.status === 'running'} grow />{' '}
                    <Text width="field-sm" shrink={false} align="end" nowrap tone="muted" tabular>
                      {item.status === 'running' && item.total <= 1 ? <Elapsed since={item.at} /> : `${item.done.toLocaleString()}/${item.total.toLocaleString()}`}
                    </Text>
                    <Text display="desktop" width="field-lg" shrink={false} align="end" variant="caption" nowrap tone="muted">{dateTime(item.at)}</Text>
                  </Link>
                </ListRow>
              </li>
            ))}
          </Box>
        )}
      </section>
    </Page>
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const content = (
    <>
      <TodoIcon alert={todo.alert}>{todo.icon}</TodoIcon>
      <Text minWidth={0} grow>
        <Text display="block" variant="label">{todo.title}</Text>
        {todo.description && <Text display="block" truncate variant="caption" tone="muted">{todo.description}</Text>}
      </Text>
      <Text variant="reading" weight="semibold" tabular tone={todo.alert ? 'danger' : undefined}>{todo.count.toLocaleString()}</Text>
      <Icon icon={ChevronRight} size="md" tone="muted" />
    </>
  );
  return <ListRow as="link" variant="bordered">{cloneElement(todo.link, { children: content })}</ListRow>;
}
