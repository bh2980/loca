import { DockProvider, DockInspector, DockHeader, WorkspaceShell, PageHeader, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, SidebarTrigger, AppStatusBar, STATUS_BAR_SLOT_ID, Popover, PopoverTrigger, StatusIcon, SidebarInset, SidebarProvider, Box, Count, DockPane, Icon, Inline, ListRow, Chip, Meter, Progress, Stack, StatusBarButton, Text, Spinner, TextLink, PopoverContent, SectionHeading, EmptyState } from '@loca/ui';
import { useCallback, useEffect, useState } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { Ban, Bell, CheckCircle2, Pause, TriangleAlert, X } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ProposalList } from '@/components/chat/proposal-list';
import { CommandSearch } from '@/components/command-search';
import { ExportDialog } from '@/components/export-dialog';
import { ShortcutHelp } from '@/components/shortcut-help';
import { chatDock, useChatDockOpen } from '@/lib/chat-dock';
import { chipHref } from '@/lib/chat-links';
import { viewStore } from '@/lib/reported-view';
import { useShortcuts } from '@/lib/shortcuts';
import { useChatUnread } from '@/lib/chat-unread';
import { dateTime } from '@/lib/datetime';
import { useRunNotices, type RunNotice } from '@/lib/run-notices';
import { useCurrentNav } from '@/lib/nav';
import { useProgress } from '@/lib/use-progress';
import { shownAfterClear, useRecentRunsCleared } from '@/lib/recent-runs';
import { loadProject } from '@/lib/project';
import { useProposals } from '@/lib/proposals';
import { INPUT_TYPES } from '@loca/shared';

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
  // A new selection shows its pane unless the chat is open: then the chat stays, and the selection reaches it as a chip (useReportView).
  const autoReveal = useCallback(() => { if (!chatDock.get()) revealProperties(); }, [revealProperties]);
  useShortcuts({
    chat: () => chatDock.toggle(),
    attachToChat: () =>
      chatDock.attach(
        projectId,
        Object.values(viewStore.get().items)
          .flat()
          .map((item) => ({
            kind: item.kind,
            id: item.id,
            label: item.label,
            ...(item.detail && { detail: item.detail }),
            ...(chipHref(projectId, item) && { href: chipHref(projectId, item) }),
          })),
      ),
  });
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
  const runNotices = useRunNotices(projectId);
  const bellCount = waiting + runNotices.unread;
  const alarming = runNotices.notices.some((n) => !n.read && (n.kind === 'failed' || n.kind === 'paused'));
  // 최근 실행 after its 지우기: only runs that ended since (the runs page keeps them all).
  const [clearedAt, clearRecent] = useRecentRunsCleared(projectId);
  const recentShown = progress.recentRuns.filter((run) => shownAfterClear(run, clearedAt));
  const runList = activeCount > 0 ? progress.activeRuns : recentShown;

  return (
    <DockProvider onActivate={revealProperties} onAutoActivate={autoReveal} onContentChange={setHasInspector}>
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

              {/* Closing it reads the notices: the count goes and items stay listed until dismissed. */}
              <Popover onOpenChange={(next) => !next && runNotices.markAllRead()}>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="tight" aria-label={bellCount > 0 ? `알림 ${bellCount}건` : '알림'}>
                    <Icon icon={Bell} size="xs" />
                    {bellCount > 0 && (
                      <Text weight="medium" tabular tone={alarming ? 'danger' : 'accent'}>
                        {bellCount}
                      </Text>
                    )}
                  </StatusBarButton>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" width={waiting > 0 ? 'popover-lg' : 'popover'} maxHeight="dialog">
                  <Box spaceY="normal">
                    <SectionHeading
                      ruled
                      as="h3"
                      actions={runNotices.notices.length > 0 ? <Button variant="ghost" onClick={runNotices.dismissAll}>모두 지우기</Button> : undefined}
                    >
                      알림
                    </SectionHeading>
                    {/* Changes sent from the terminal (loca), decided here: the chat holds only its own conversation's. */}
                    {waiting > 0 && (
                      <Box spaceY="tight">
                        <SectionHeading level="group" marginBottom="none" actions={<Count>{waiting}</Count>}>
                          결정할 제안
                        </SectionHeading>
                        <ProposalList projectId={projectId} proposals={pending} />
                      </Box>
                    )}
                    {runNotices.notices.length > 0 && (
                      <Box spaceY="condensed">
                        <SectionHeading level="group" marginBottom="none">실행</SectionHeading>
                        {runNotices.notices.slice(0, 20).map((n) => (
                          <RunNoticeRow key={n.id} projectId={projectId} notice={n} onDismiss={() => runNotices.dismiss(n.id)} />
                        ))}
                      </Box>
                    )}
                    {waiting === 0 && runNotices.notices.length === 0 && (
                      <Text as="p" paddingY="tight" align="center" variant="caption" tone="muted">새 알림이 없습니다.</Text>
                    )}
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

function RunNoticeRow({ projectId, notice: n, onDismiss }: { projectId: string; notice: RunNotice; onDismiss: () => void }) {
  const unit = INPUT_TYPES[n.subject].unit;
  const icon =
    n.kind === 'completed' ? (
      <Icon icon={CheckCircle2} size="xs" shrink={false} tone="success" />
    ) : n.kind === 'failed' ? (
      <Icon icon={TriangleAlert} size="xs" shrink={false} tone="danger" />
    ) : n.kind === 'paused' ? (
      <Icon icon={Pause} size="xs" shrink={false} tone="warning" />
    ) : (
      <Icon icon={Ban} size="xs" shrink={false} tone="muted" />
    );
  const line =
    n.kind === 'completed'
      ? `완료 · ${n.total.toLocaleString()}${unit}`
      : n.kind === 'failed'
        ? `완료 ${n.done.toLocaleString()}${unit} · 실패 ${n.failed.toLocaleString()}${unit}`
        : n.kind === 'paused'
          ? `일시정지 · ${n.notice ?? '이어서 실행할 수 있습니다'}`
          : `취소됨 · ${n.done.toLocaleString()}/${n.total.toLocaleString()}${unit}`;
  return (
    <Inline gap="tight" align="center">
      <Box grow minWidth={0}>
        <ListRow as="link" density="loose">
          <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: n.id }}>
            <Inline minWidth={0} gap="tight" truncate>
              {icon}
              <Text truncate weight={n.read ? undefined : 'medium'}>{n.workflowName}</Text>
            </Inline>
            <Text minWidth={0} variant="caption" tabular tone="muted" truncate title={n.notice ?? undefined}>
              {line} · {dateTime(n.endedAt)}
            </Text>
          </Link>
        </ListRow>
      </Box>
      <Button variant="ghost" size="icon-xs" aria-label="알림 지우기" onClick={onDismiss}>
        <Icon icon={X} size="xs" />
      </Button>
    </Inline>
  );
}
