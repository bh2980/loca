import { DockProvider, DockInspector, DockHeader, WorkspaceShell, PageHeader, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, SidebarTrigger, AppStatusBar, STATUS_BAR_SLOT_ID, Popover, PopoverTrigger, StatusIcon, AccentSpinner, AppShellInset, AppShellProvider, Box, CountBadge, DockPane, FlushGroupHeading, FullPageEmpty, Icon, Inline, NoticeBox, PopoverActionLink, PopoverRowLink, PopoverSectionTitle, RunProgressBar, RunStatusBadge, Stack, StatusBarButton, StatusMeter, StatusPopoverContent, Text, GroupHeading } from '@loca/ui';
import { useCallback, useEffect, useState } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCircle2, Play, TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CommandSearch } from '@/components/command-search';
import { chatDock, useChatDockOpen } from '@/lib/chat-dock';
import { useChatUnread } from '@/lib/chat-unread';
import { q } from '@/lib/queries';
import { useJobNotices } from '@/lib/job-notices';
import { useCurrentNav } from '@/lib/nav';
import { useProgress } from '@/lib/use-progress';
import { dateTime } from '@/lib/datetime';

export const Route = createFileRoute('/p/$projectId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.project(params.projectId)),
  component: ProjectLayout,
  errorComponent: ({ error }) => (
    <FullPageEmpty>
      <EmptyHeader>
        <EmptyTitle>{error instanceof ApiError && error.status === 404 ? '프로젝트를 찾을 수 없습니다' : '화면을 불러오지 못했습니다'}</EmptyTitle>
        <EmptyDescription>{error instanceof Error ? error.message : String(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/">프로젝트 목록으로</Link>
        </Button>
      </EmptyContent>
    </FullPageEmpty>
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
  const proposals = useQuery(q.proposals(projectId));
  const waiting = (proposals.data ?? []).filter((proposal) => proposal.status === 'pending').length;
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
  const firstActive = progress.activeRuns[0];
  const runDone = (r: (typeof progress.activeRuns)[number]) =>
    (r.states.done ?? 0) + (r.states.failed ?? 0) + (r.states.cancelled ?? 0) + (r.states.skipped ?? 0);
  const firstActiveDone = firstActive ? runDone(firstActive) : 0;
  const failedRuns = progress.recentRuns.filter((run) => (run.states.failed ?? 0) > 0 || run.status === 'paused');
  const hasNotification = waiting > 0 || failedRuns.length > 0;

  return (
    <DockProvider onActivate={revealProperties} onContentChange={setHasInspector}>
      <AppShellProvider>
        <AppSidebar projectId={projectId} />
        <AppShellInset>
          <WorkspaceShell open={open} onOpenChange={(next) => { setPropertiesOpen(next); if (!next) chatDock.set(false); }} dock={<>
            <DockHeader mode={chatOpen ? 'agent' : 'properties'} onMode={changeMode} onToggle={toggleDock} unread={unread || waiting > 0} tools={<CommandSearch projectId={projectId} compact />} hasProperties={hasInspector} />
            <DockPane active={!chatOpen}><DockInspector /></DockPane>
            <DockPane active={chatOpen}><ChatPanel projectId={projectId} /></DockPane>
          </>}>
            <PageHeader title={current.item.label} leading={<SidebarTrigger />} tools={!open && <DockHeader mode="properties" onMode={changeMode} onToggle={toggleDock} open={false} tools={<CommandSearch projectId={projectId} compact />} />} />
            <Stack as="main" minHeight={0} grow overflow="hidden" background="background"><Outlet /></Stack>
            <AppStatusBar>
              <Popover>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="condensed">
                    <StatusMeter variant="footer" statuses={progress.statuses} counts={progress.counts} />
                    <Text nowrap tabular>
                      확정 {progress.done.toLocaleString()}/{progress.total.toLocaleString()} ({percent}%)
                    </Text>
                  </StatusBarButton>
                </PopoverTrigger>
                <StatusPopoverContent side="top" align="start">
                  <Box spaceY="cozy">
                    <PopoverSectionTitle as="h3" actions={<Text variant="caption" weight="normal" tone="muted" tabular>전체 {progress.total.toLocaleString()}줄 중 {progress.done.toLocaleString()}줄 확정</Text>}>
                      번역 진행
                    </PopoverSectionTitle>
                    <Box spaceY="tight">
                      {progress.statuses.map((s) => {
                        const count = progress.counts[s.id] ?? 0;
                        const pct = progress.total > 0 ? Math.round((count / progress.total) * 100) : 0;
                        return (
                          <PopoverRowLink key={s.id} variant="status">
                            <Link
                              to="/p/$projectId/script"
                              params={{ projectId }}
                              search={{ statuses: [s.id] }}
                            >
                              <Inline as="span" gap="snug">
                                <StatusIcon status={s} />
                                <span>{s.name}</span>
                              </Inline>
                              <Text variant="caption" tone="muted" tabular>
                                {count.toLocaleString()}줄 ({pct}%)
                              </Text>
                            </Link>
                          </PopoverRowLink>
                        );
                      })}
                    </Box>
                    {progress.reviewCount > 0 && (
                      <Box border="top" paddingTop="condensed">
                        <PopoverRowLink variant="review">
                          <Link
                            to="/p/$projectId/script"
                            params={{ projectId }}
                            search={{ review: true }}
                          >
                            <Inline as="span" gap="snug">
                              <Icon icon={TriangleAlert} size="sm" />
                              <span>검토 필요</span>
                            </Inline>
                            <Text weight="medium" tabular>{progress.reviewCount.toLocaleString()}줄</Text>
                          </Link>
                        </PopoverRowLink>
                      </Box>
                    )}
                  </Box>
                </StatusPopoverContent>
              </Popover>

              <Box id={STATUS_BAR_SLOT_ID} minWidth={0} grow truncate />

              <Popover>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="snug" marginLeft="auto">
                    {activeCount > 0 ? (
                      <>
                        <AccentSpinner />
                        <Text nowrap tabular>
                          {firstActive.workflowName} ({firstActiveDone.toLocaleString()}/{firstActive.total.toLocaleString()})
                          {activeCount > 1 && ` 외 ${activeCount - 1}건`}
                        </Text>
                      </>
                    ) : (
                      <Text nowrap tone="muted">워크플로 대기</Text>
                    )}
                  </StatusBarButton>
                </PopoverTrigger>
                <StatusPopoverContent wide side="top" align="end">
                  <Box spaceY="cozy">
                    <PopoverSectionTitle
                      as="h3"
                      actions={
                        <PopoverActionLink>
                          <Link to="/p/$projectId/runs" params={{ projectId }}>
                            전체 보기
                          </Link>
                        </PopoverActionLink>
                      }
                    >
                      {activeCount > 0 ? `실행 중 ${activeCount}` : '최근 실행'}
                    </PopoverSectionTitle>
                    <Box spaceY="condensed">
                      {(activeCount > 0 ? progress.activeRuns : progress.recentRuns).length === 0 ? (
                        <Text as="p" paddingY="condensed" align="center" variant="caption" tone="muted">실행 기록이 없습니다.</Text>
                      ) : (
                        (activeCount > 0 ? progress.activeRuns : progress.recentRuns).map((run) => {
                          const done = runDone(run);
                          const pct = run.total > 0 ? Math.round((done / run.total) * 100) : 0;
                          const hasFail = (run.states.failed ?? 0) > 0;
                          return (
                            <PopoverRowLink key={run.id} variant="run">
                            <Link
                              to="/p/$projectId/runs/$runId"
                              params={{ projectId, runId: run.id }}
                            >
                              <Inline justify="between" gap="condensed">
                                <Text truncate>{run.workflowName}</Text>
                                <RunStatusBadge
                                  variant={
                                    run.status === 'running'
                                      ? 'default'
                                      : run.status === 'paused' || hasFail
                                        ? 'destructive'
                                        : 'secondary'
                                  }
                                >
                                  {run.status === 'running'
                                    ? '실행 중'
                                    : run.status === 'paused'
                                      ? '일시정지'
                                      : run.status === 'completed'
                                        ? '완료'
                                        : '취소됨'}
                                </RunStatusBadge>
                              </Inline>
                              <Inline gap="condensed">
                                <RunProgressBar value={pct} />
                                <Text shrink={false} variant="caption" tabular tone="muted">
                                  {done.toLocaleString()}/{run.total.toLocaleString()} ({pct}%)
                                </Text>
                              </Inline>
                            </Link>
                            </PopoverRowLink>
                          );
                        })
                      )}
                    </Box>
                  </Box>
                </StatusPopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="tight" aria-label="알림">
                    <Icon icon={Bell} size="xs" />
                    {hasNotification && (
                      <Text weight="medium" tabular tone={failedRuns.length > 0 ? 'danger' : 'primary'}>
                        {waiting > 0 ? waiting : '!'}
                      </Text>
                    )}
                  </StatusBarButton>
                </PopoverTrigger>
                <StatusPopoverContent wide side="top" align="end">
                  <Box spaceY="normal">
                    <PopoverSectionTitle
                      as="h3"
                      actions={
                        waiting > 0 ? (
                          <CountBadge variant="secondary">
                            {waiting}건 대기
                          </CountBadge>
                        ) : undefined
                      }
                    >
                      알림
                    </PopoverSectionTitle>
                    {waiting > 0 && (
                      <NoticeBox>
                        <Inline justify="between">
                          <GroupHeading>대기 중인 제안</GroupHeading>
                          <CountBadge variant="default">
                            {waiting}건
                          </CountBadge>
                        </Inline>
                        <Button
                          variant="outline"
                          width="full"
                          onClick={() => {
                            setLastMode('agent');
                            setPropertiesOpen(true);
                            chatDock.set(true);
                          }}
                        >
                          에이전트 열기
                        </Button>
                      </NoticeBox>
                    )}
                    <Box spaceY="snug">
                      <FlushGroupHeading
                        actions={
                          <PopoverActionLink>
                            <Link to="/p/$projectId/runs" params={{ projectId }}>
                              실행 기록
                            </Link>
                          </PopoverActionLink>
                        }
                      >
                        최근 실행
                      </FlushGroupHeading>
                      {progress.recentRuns.length === 0 ? (
                        <Text as="p" paddingY="tight" align="center" variant="caption" tone="muted">기록이 없습니다.</Text>
                      ) : (
                        progress.recentRuns.slice(0, 3).map((run) => (
                          <PopoverRowLink key={run.id} variant="recent">
                            <Link
                              to="/p/$projectId/runs/$runId"
                              params={{ projectId, runId: run.id }}
                            >
                              <Inline minWidth={0} gap="snug" truncate>
                                {run.status === 'completed' && (run.states.failed ?? 0) === 0 && <Icon icon={CheckCircle2} size="xs" shrink={false} tone="success" />}
                                {((run.states.failed ?? 0) > 0 || run.status === 'cancelled') && <Icon icon={TriangleAlert} size="xs" shrink={false} tone="danger" />}
                                {run.status === 'running' && <AccentSpinner fixed />}
                                {run.status === 'paused' && <Icon icon={Play} size="xs" shrink={false} tone="warning" />}
                                <Text truncate>{run.workflowName}</Text>
                              </Inline>
                              <Text shrink={false} variant="caption" tabular tone="muted">
                                {dateTime(run.createdAt)}
                              </Text>
                            </Link>
                          </PopoverRowLink>
                        ))
                      )}
                    </Box>
                  </Box>
                </StatusPopoverContent>
              </Popover>
            </AppStatusBar>
          </WorkspaceShell>
        </AppShellInset>
      </AppShellProvider>
    </DockProvider>
  );
}
