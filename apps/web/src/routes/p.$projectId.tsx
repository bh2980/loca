import { DockProvider, DockInspector, DockHeader, WorkspaceShell, PageHeader, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, SidebarTrigger, AppStatusBar, STATUS_BAR_SLOT_ID, Popover, PopoverTrigger, StatusIcon, SidebarInset, SidebarProvider, Box, Count, DockPane, Icon, Inline, Notice, ListRow, Chip, Meter, Progress, Stack, StatusBarButton, Text, Spinner, TextLink, PopoverContent, SectionHeading, EmptyState } from '@loca/ui';
import { useCallback, useEffect, useState } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { Bell, CheckCircle2, Pause, Play, TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ProposalList } from '@/components/chat/proposal-list';
import { CommandSearch } from '@/components/command-search';
import { ExportDialog } from '@/components/export-dialog';
import { ShortcutHelp } from '@/components/shortcut-help';
import { chatDock, useChatDockOpen } from '@/lib/chat-dock';
import { useChatUnread } from '@/lib/chat-unread';
import { clearRunNews, useJobNotices, useRunNews } from '@/lib/job-notices';
import { useCurrentNav } from '@/lib/nav';
import { useProgress } from '@/lib/use-progress';
import { shownAfterClear, useRecentRunsCleared } from '@/lib/recent-runs';
import { dateTime } from '@/lib/datetime';
import { loadProject } from '@/lib/project';
import { useProposals } from '@/lib/proposals';
import { INPUT_TYPES } from '@tw/shared';

export const Route = createFileRoute('/p/$projectId')({
  // The project row, or the not-found page.
  loader: ({ params }) => loadProject(params.projectId),
  component: ProjectLayout,
  errorComponent: ({ error }) => (
    <EmptyState size="page">
      <EmptyHeader>
        <EmptyTitle>{error instanceof ApiError && error.status === 404 ? '프로젝트를 찾을 수 없습니다' : '화면을 불러오지 못했습니다'}</EmptyTitle>
        <EmptyDescription>{error instanceof Error ? error.message : String(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/">프로젝트 목록으로</Link>
        </Button>
      </EmptyContent>
    </EmptyState>
  ),
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const chatOpen = useChatDockOpen();
  const unread = useChatUnread(projectId, chatOpen);
  const current = useCurrentNav(projectId);
  const progress = useProgress(projectId);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [hasInspector, setHasInspector] = useState(false);
  const [lastMode, setLastMode] = useState<'properties' | 'agent'>('properties');
  const open = chatOpen || (propertiesOpen && hasInspector);
  useEffect(() => { if (chatOpen) setLastMode('agent'); }, [chatOpen]);
  const revealProperties = useCallback(() => {
    setLastMode('properties');
    setPropertiesOpen(true);
    chatDock.set(false);
  }, []);
  useJobNotices(projectId);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        chatDock.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const terminalProposals = useProposals(projectId, { status: 'pending' });
  const waiting = terminalProposals.total ?? 0;
  const pending = terminalProposals.data ?? [];
  const changeMode = (mode: 'properties' | 'agent') => {
    if (mode === 'properties' && !hasInspector) return;
    setLastMode(mode);
    setPropertiesOpen(true);
    chatDock.set(mode === 'agent');
  };
  const toggleDock = () => {
    if (open) { setPropertiesOpen(false); chatDock.set(false); }
    else changeMode(lastMode === 'properties' && hasInspector ? 'properties' : 'agent');
  };

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const activeCount = progress.activeRuns.length;
  // A running run first: a paused one is shown as paused (⏸), never with the spinner.
  const firstActive = progress.activeRuns.find((run) => run.status === 'running') ?? progress.activeRuns[0];
  const allPaused = activeCount > 0 && progress.activeRuns.every((run) => run.status === 'paused');
  const runDone = (r: (typeof progress.activeRuns)[number]) =>
    (r.states.done ?? 0) + (r.states.failed ?? 0) + (r.states.cancelled ?? 0) + (r.states.skipped ?? 0);
  const firstActiveDone = firstActive ? runDone(firstActive) : 0;
  const failedRuns = progress.recentRuns.filter((run) => (run.states.failed ?? 0) > 0 || run.status === 'paused');
  // Runs that ended since the bell was last opened: counted on it, listed first, and not listed again below.
  const runNews = useRunNews(projectId);
  const lookRuns = failedRuns.filter((run) => !runNews.some((news) => news.id === run.id));
  const bellCount = waiting + runNews.length;
  const hasNotification = bellCount > 0 || failedRuns.length > 0;
  const alarming = failedRuns.length > 0 || runNews.some((run) => run.status === 'paused');
  // 최근 실행 after its 지우기: only runs that ended since (the runs page keeps them all).
  const [clearedAt, clearRecent] = useRecentRunsCleared(projectId);
  const recentShown = progress.recentRuns.filter((run) => shownAfterClear(run, clearedAt));
  const runList = activeCount > 0 ? progress.activeRuns : recentShown;

  return (
    <DockProvider onActivate={revealProperties} onContentChange={setHasInspector}>
      <SidebarProvider>
        <AppSidebar projectId={projectId} />
        <SidebarInset>
          <WorkspaceShell open={open} onOpenChange={(next) => { setPropertiesOpen(next); if (!next) chatDock.set(false); }} dock={<>
            <DockHeader mode={chatOpen ? 'agent' : 'properties'} onMode={changeMode} onToggle={toggleDock} unread={unread} tools={<><CommandSearch projectId={projectId} compact listen={open} /><ShortcutHelp listen={open} /></>} hasProperties={hasInspector} />
            <DockPane active={!chatOpen}><DockInspector /></DockPane>
            <DockPane active={chatOpen}><ChatPanel projectId={projectId} active={chatOpen} /></DockPane>
          </>}>
            <PageHeader title={current.item.label} leading={<SidebarTrigger />} tools={!open && <DockHeader mode="properties" onMode={changeMode} onToggle={toggleDock} open={false} tools={<><CommandSearch projectId={projectId} compact /><ShortcutHelp /></>} />} />
            <Stack as="main" minHeight={0} grow overflow="hidden" background="page"><Outlet /></Stack>
            <ExportDialog projectId={projectId} />
            <AppStatusBar>
              <Popover>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="condensed">
                    <Meter width="compact" statuses={progress.statuses} counts={progress.counts} />
                    <Text nowrap tabular>
                      확정 {progress.done.toLocaleString()}/{progress.total.toLocaleString()} ({percent}%)
                    </Text>
                  </StatusBarButton>
                </PopoverTrigger>
                <PopoverContent side="top" align="start">
                  <Box spaceY="normal">
                    <SectionHeading ruled as="h3" actions={<Text variant="caption" weight="normal" tone="muted" tabular>전체 {progress.total.toLocaleString()}줄 중 {progress.done.toLocaleString()}줄 확정</Text>}>
                      번역 진행
                    </SectionHeading>
                    <Box spaceY="tight">
                      {progress.statuses.map((s) => {
                        const count = progress.counts[s.id] ?? 0;
                        const pct = progress.total > 0 ? Math.round((count / progress.total) * 100) : 0;
                        return (
                          <ListRow as="link" key={s.id}>
                            <Link
                              to="/p/$projectId/script"
                              params={{ projectId }}
                              search={{ statuses: [s.id] }}
                            >
                              <Inline as="span" gap="tight">
                                <StatusIcon status={s} />
                                <span>{s.name}</span>
                              </Inline>
                              <Text variant="caption" tone="muted" tabular>
                                {count.toLocaleString()}줄 ({pct}%)
                              </Text>
                            </Link>
                          </ListRow>
                        );
                      })}
                    </Box>
                    {progress.reviewCount > 0 && (
                      <Box border="top" paddingTop="condensed">
                        <ListRow as="link" tone="warning">
                          <Link
                            to="/p/$projectId/script"
                            params={{ projectId }}
                            search={{ review: true }}
                          >
                            <Inline as="span" gap="tight">
                              <Icon icon={TriangleAlert} size="sm" />
                              <span>검토 필요</span>
                            </Inline>
                            <Text weight="medium" tabular>{progress.reviewCount.toLocaleString()}줄</Text>
                          </Link>
                        </ListRow>
                      </Box>
                    )}
                  </Box>
                </PopoverContent>
              </Popover>

              <Box id={STATUS_BAR_SLOT_ID} minWidth={0} grow truncate />

              <Popover>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="tight" marginLeft="auto">
                    {activeCount > 0 ? (
                      <>
                        {allPaused ? <Icon icon={Pause} size="xs" shrink={false} tone="warning" /> : <Spinner size="xs" tone="accent" />}
                        <Text nowrap tabular>
                          {allPaused && '일시정지 · '}{firstActive.workflowName} ({firstActiveDone.toLocaleString()}/{firstActive.total.toLocaleString()})
                          {activeCount > 1 && ` 외 ${activeCount - 1}건`}
                        </Text>
                      </>
                    ) : (
                      <Text nowrap tone="muted">워크플로 대기</Text>
                    )}
                  </StatusBarButton>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" width="popover">
                  <Box spaceY="normal">
                    <SectionHeading ruled
                      as="h3"
                      actions={
                        // Hides the finished runs here only; nothing is deleted.
                        activeCount === 0 && recentShown.length > 0 ? <Button variant="ghost" size="inline" onClick={clearRecent}>지우기</Button> : undefined
                      }
                    >
                      {activeCount > 0 ? `실행 중 ${activeCount}` : '최근 실행'}
                      <Text marginLeft="condensed" variant="caption" weight="normal">
                        <TextLink asChild tone="muted" underline="always" quiet>
                          <Link to="/p/$projectId/runs" params={{ projectId }}>
                            전체 보기
                          </Link>
                        </TextLink>
                      </Text>
                    </SectionHeading>
                    <Box spaceY="condensed">
                      {runList.length === 0 ? (
                        <Text as="p" paddingY="condensed" align="center" variant="caption" tone="muted">{clearedAt && progress.recentRuns.length ? '지운 뒤 끝난 실행이 없습니다.' : '실행 기록이 없습니다.'}</Text>
                      ) : (
                        runList.map((run) => {
                          const done = runDone(run);
                          const pct = run.total > 0 ? Math.round((done / run.total) * 100) : 0;
                          const hasFail = (run.states.failed ?? 0) > 0;
                          return (
                            <ListRow as="link" key={run.id} density="loose" stacked>
                            <Link
                              to="/p/$projectId/runs/$runId"
                              params={{ projectId, runId: run.id }}
                            >
                              <Inline justify="between" gap="condensed">
                                <Text truncate>{run.workflowName}</Text>
                                <Chip
                                  size="tight"
                                  variant={run.status === 'preparing' || run.status === 'running' || run.status === 'paused' || hasFail ? 'solid' : 'quiet'}
                                  tone={run.status !== 'running' && run.status !== 'preparing' && (run.status === 'paused' || hasFail) ? 'danger' : undefined}
                                >
                                  {run.status === 'preparing'
                                    ? '준비 중'
                                    : run.status === 'running'
                                    ? '실행 중'
                                    : run.status === 'paused'
                                      ? '일시정지'
                                      : run.status === 'completed'
                                        ? '완료'
                                        : '취소됨'}
                                </Chip>
                              </Inline>
                              <Inline gap="condensed">
                                <Progress size="sm" grow value={pct} />
                                <Text shrink={false} variant="caption" tabular tone="muted">
                                  {done.toLocaleString()}/{run.total.toLocaleString()} ({pct}%)
                                </Text>
                              </Inline>
                            </Link>
                            </ListRow>
                          );
                        })
                      )}
                    </Box>
                  </Box>
                </PopoverContent>
              </Popover>

              {/* Closing it reads what ended: the count goes and those runs stay under 최근 실행. */}
              <Popover onOpenChange={(next) => !next && clearRunNews(projectId)}>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="tight" aria-label={bellCount > 0 ? `알림 ${bellCount}건` : '알림'}>
                    <Icon icon={Bell} size="xs" />
                    {hasNotification && (
                      <Text weight="medium" tabular tone={alarming ? 'danger' : 'accent'}>
                        {bellCount > 0 ? bellCount : '!'}
                      </Text>
                    )}
                  </StatusBarButton>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" width={waiting > 0 ? 'popover-lg' : 'popover'} maxHeight="dialog">
                  <Box spaceY="normal">
                    <SectionHeading ruled
                      as="h3"
                      actions={
                        waiting > 0 ? (
                          <Count>
                            {waiting}건 대기
                          </Count>
                        ) : undefined
                      }
                    >
                      알림
                    </SectionHeading>
                    {/* Changes sent from the terminal (loca), decided here: the chat holds only its own conversation's. */}
                    {waiting > 0 && (
                      <Box spaceY="tight">
                        <SectionHeading level="group" marginBottom="none">터미널에서 온 제안</SectionHeading>
                        <ProposalList projectId={projectId} proposals={pending} />
                      </Box>
                    )}
                    {/* Runs that ended while the project was open, in place of a toast of their own. */}
                    {runNews.length > 0 && (
                      <Box spaceY="condensed">
                        <SectionHeading level="group" marginBottom="none">끝난 실행</SectionHeading>
                        {runNews.slice(0, 5).map((run) => (
                          <ListRow as="link" key={run.id} density="loose">
                            <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }}>
                              <Inline minWidth={0} gap="tight" truncate>
                                {run.status === 'paused' ? <Icon icon={Pause} size="xs" shrink={false} tone="warning" /> : <Icon icon={CheckCircle2} size="xs" shrink={false} tone="success" />}
                                <Text truncate>{run.workflowName}</Text>
                              </Inline>
                              <Text minWidth={0} variant="caption" tabular tone="muted" truncate title={run.notice ?? undefined}>
                                {run.status === 'paused' ? (run.notice ?? '일시정지') : `${run.total.toLocaleString()}${INPUT_TYPES[run.subject].unit} 끝남`}
                              </Text>
                            </Link>
                          </ListRow>
                        ))}
                      </Box>
                    )}
                    {/* Only the runs that need a look (failed lines, paused): every recent run is under 워크플로 next to it. */}
                    {lookRuns.length > 0 && (
                      <Box spaceY="condensed">
                        <SectionHeading level="group" marginBottom="none">확인할 실행</SectionHeading>
                        {lookRuns.slice(0, 3).map((run) => (
                          <ListRow as="link" key={run.id} density="loose">
                            <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: run.id }}>
                              <Inline minWidth={0} gap="tight" truncate>
                                {run.status === 'paused' ? <Icon icon={Play} size="xs" shrink={false} tone="warning" /> : <Icon icon={TriangleAlert} size="xs" shrink={false} tone="danger" />}
                                <Text truncate>{run.workflowName}</Text>
                              </Inline>
                              <Text shrink={false} variant="caption" tabular tone="muted">
                                {run.status === 'paused' ? '일시정지' : `실패 ${(run.states.failed ?? 0).toLocaleString()}줄`}
                              </Text>
                            </Link>
                          </ListRow>
                        ))}
                      </Box>
                    )}
                    {!hasNotification && <Text as="p" paddingY="tight" align="center" variant="caption" tone="muted">새 알림이 없습니다.</Text>}
                  </Box>
                </PopoverContent>
              </Popover>
            </AppStatusBar>
          </WorkspaceShell>
        </SidebarInset>
      </SidebarProvider>
    </DockProvider>
  );
}
