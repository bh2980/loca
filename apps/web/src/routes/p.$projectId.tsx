import { DockProvider, DockInspector, DockHeader, WorkspaceShell, PageHeader, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, SidebarTrigger, AppStatusBar, STATUS_BAR_SLOT_ID, Popover, PopoverTrigger, StatusIcon, SidebarInset, SidebarProvider, Box, Count, DockPane, Icon, Inline, Notice, ListRow, Chip, Meter, Progress, Stack, StatusBarButton, Text, Spinner, TextLink, PopoverContent, SectionHeading, EmptyState } from '@loca/ui';
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
      <SidebarProvider>
        <AppSidebar projectId={projectId} />
        <SidebarInset>
          <WorkspaceShell open={open} onOpenChange={(next) => { setPropertiesOpen(next); if (!next) chatDock.set(false); }} dock={<>
            <DockHeader mode={chatOpen ? 'agent' : 'properties'} onMode={changeMode} onToggle={toggleDock} unread={unread || waiting > 0} tools={<CommandSearch projectId={projectId} compact />} hasProperties={hasInspector} />
            <DockPane active={!chatOpen}><DockInspector /></DockPane>
            <DockPane active={chatOpen}><ChatPanel projectId={projectId} /></DockPane>
          </>}>
            <PageHeader title={current.item.label} leading={<SidebarTrigger />} tools={!open && <DockHeader mode="properties" onMode={changeMode} onToggle={toggleDock} open={false} tools={<CommandSearch projectId={projectId} compact />} />} />
            <Stack as="main" minHeight={0} grow overflow="hidden" background="page"><Outlet /></Stack>
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
                  <Box spaceY="cozy">
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
                              <Inline as="span" gap="snug">
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
                            <Inline as="span" gap="snug">
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
                  <StatusBarButton gap="snug" marginLeft="auto">
                    {activeCount > 0 ? (
                      <>
                        <Spinner size="xs" tone="accent" />
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
                <PopoverContent side="top" align="end" width="popover">
                  <Box spaceY="cozy">
                    <SectionHeading ruled
                      as="h3"
                      actions={
                        <TextLink asChild variant="caption" weight="normal" tone="muted" underline="always" quiet>
                          <Link to="/p/$projectId/runs" params={{ projectId }}>
                            전체 보기
                          </Link>
                        </TextLink>
                      }
                    >
                      {activeCount > 0 ? `실행 중 ${activeCount}` : '최근 실행'}
                    </SectionHeading>
                    <Box spaceY="condensed">
                      {(activeCount > 0 ? progress.activeRuns : progress.recentRuns).length === 0 ? (
                        <Text as="p" paddingY="condensed" align="center" variant="caption" tone="muted">실행 기록이 없습니다.</Text>
                      ) : (
                        (activeCount > 0 ? progress.activeRuns : progress.recentRuns).map((run) => {
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
                                  variant={run.status === 'running' || run.status === 'paused' || hasFail ? 'solid' : 'quiet'}
                                  tone={run.status !== 'running' && (run.status === 'paused' || hasFail) ? 'danger' : undefined}
                                >
                                  {run.status === 'running'
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

              <Popover>
                <PopoverTrigger asChild>
                  <StatusBarButton gap="tight" aria-label="알림">
                    <Icon icon={Bell} size="xs" />
                    {hasNotification && (
                      <Text weight="medium" tabular tone={failedRuns.length > 0 ? 'danger' : 'accent'}>
                        {waiting > 0 ? waiting : '!'}
                      </Text>
                    )}
                  </StatusBarButton>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" width="popover">
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
                    {waiting > 0 && (
                      <Notice>
                        <Inline justify="between">
                          <SectionHeading level="group">대기 중인 제안</SectionHeading>
                          <Count tone="accent">
                            {waiting}건
                          </Count>
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
                      </Notice>
                    )}
                    <Box spaceY="snug">
                      <SectionHeading level="group" marginBottom="none"
                        actions={
                          <TextLink asChild variant="caption" weight="normal" tone="muted" underline="always" quiet>
                            <Link to="/p/$projectId/runs" params={{ projectId }}>
                              실행 기록
                            </Link>
                          </TextLink>
                        }
                      >
                        최근 실행
                      </SectionHeading>
                      {progress.recentRuns.length === 0 ? (
                        <Text as="p" paddingY="tight" align="center" variant="caption" tone="muted">기록이 없습니다.</Text>
                      ) : (
                        progress.recentRuns.slice(0, 3).map((run) => (
                          <ListRow as="link" key={run.id} density="loose">
                            <Link
                              to="/p/$projectId/runs/$runId"
                              params={{ projectId, runId: run.id }}
                            >
                              <Inline minWidth={0} gap="snug" truncate>
                                {run.status === 'completed' && (run.states.failed ?? 0) === 0 && <Icon icon={CheckCircle2} size="xs" shrink={false} tone="success" />}
                                {((run.states.failed ?? 0) > 0 || run.status === 'cancelled') && <Icon icon={TriangleAlert} size="xs" shrink={false} tone="danger" />}
                                {run.status === 'running' && <Spinner size="xs" tone="accent" fixed />}
                                {run.status === 'paused' && <Icon icon={Play} size="xs" shrink={false} tone="warning" />}
                                <Text truncate>{run.workflowName}</Text>
                              </Inline>
                              <Text shrink={false} variant="caption" tabular tone="muted">
                                {dateTime(run.createdAt)}
                              </Text>
                            </Link>
                          </ListRow>
                        ))
                      )}
                    </Box>
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
