import { DockProvider, DockInspector, DockHeader, WorkspaceShell, PageHeader, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, SidebarInset, SidebarProvider, SidebarTrigger, AppStatusBar, StatusBar, STATUS_BAR_SLOT_ID, Popover, PopoverContent, PopoverTrigger, SectionHeading, GroupHeading, StatusIcon, Badge, Spinner, Progress } from '@loca/ui';
import { cn } from '@/lib/utils';
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
    <Empty className="m-auto min-h-svh">
      <EmptyHeader>
        <EmptyTitle>{error instanceof ApiError && error.status === 404 ? '프로젝트를 찾을 수 없습니다' : '화면을 불러오지 못했습니다'}</EmptyTitle>
        <EmptyDescription>{error instanceof Error ? error.message : String(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/">프로젝트 목록으로</Link>
        </Button>
      </EmptyContent>
    </Empty>
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
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar projectId={projectId} />
        <SidebarInset className="min-w-0 overflow-hidden">
          <WorkspaceShell open={open} onOpenChange={(next) => { setPropertiesOpen(next); if (!next) chatDock.set(false); }} dock={<>
            <DockHeader mode={chatOpen ? 'agent' : 'properties'} onMode={changeMode} onToggle={toggleDock} unread={unread || waiting > 0} tools={<CommandSearch projectId={projectId} compact />} hasProperties={hasInspector} />
            <div className={chatOpen ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}><DockInspector /></div>
            <div className={chatOpen ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><ChatPanel projectId={projectId} /></div>
          </>}>
            <PageHeader title={current.item.label} leading={<SidebarTrigger />} tools={!open && <DockHeader mode="properties" onMode={changeMode} onToggle={toggleDock} open={false} tools={<CommandSearch projectId={projectId} compact />} />} />
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"><Outlet /></main>
            <AppStatusBar>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-2 rounded-none px-1.5 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <StatusBar statuses={progress.statuses} counts={progress.counts} className="h-1 w-20 shrink-0" />
                    <span className="whitespace-nowrap tabular-nums">
                      확정 {progress.done.toLocaleString()}/{progress.total.toLocaleString()} ({percent}%)
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-72 p-3">
                  <div className="space-y-2.5">
                    <SectionHeading as="h3" className="border-b pb-2" actions={<span className="text-xs font-normal text-muted-foreground tabular-nums">전체 {progress.total.toLocaleString()}줄 중 {progress.done.toLocaleString()}줄 확정</span>}>
                      번역 진행
                    </SectionHeading>
                    <div className="space-y-1">
                      {progress.statuses.map((s) => {
                        const count = progress.counts[s.id] ?? 0;
                        const pct = progress.total > 0 ? Math.round((count / progress.total) * 100) : 0;
                        return (
                          <Link
                            key={s.id}
                            to="/p/$projectId/script"
                            params={{ projectId }}
                            search={{ statuses: [s.id] }}
                            className="flex items-center justify-between rounded px-1.5 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <span className="flex items-center gap-1.5">
                              <StatusIcon status={s} />
                              <span>{s.name}</span>
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {count.toLocaleString()}줄 ({pct}%)
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                    {progress.reviewCount > 0 && (
                      <div className="border-t pt-2">
                        <Link
                          to="/p/$projectId/script"
                          params={{ projectId }}
                          search={{ review: true }}
                          className="flex items-center justify-between rounded px-1.5 py-1 text-sm text-warning hover:bg-warning/10"
                        >
                          <span className="flex items-center gap-1.5">
                            <TriangleAlert className="size-3.5" />
                            <span>검토 필요</span>
                          </span>
                          <span className="font-medium tabular-nums">{progress.reviewCount.toLocaleString()}줄</span>
                        </Link>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <div id={STATUS_BAR_SLOT_ID} className="min-w-0 flex-1 truncate" />

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-5 gap-1.5 rounded-none px-1.5 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {activeCount > 0 ? (
                      <>
                        <Spinner className="size-3 text-primary" />
                        <span className="whitespace-nowrap tabular-nums">
                          {firstActive.workflowName} ({firstActiveDone.toLocaleString()}/{firstActive.total.toLocaleString()})
                          {activeCount > 1 && ` 외 ${activeCount - 1}건`}
                        </span>
                      </>
                    ) : (
                      <span className="whitespace-nowrap text-muted-foreground">워크플로 대기</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-80 p-3">
                  <div className="space-y-2.5">
                    <SectionHeading
                      as="h3"
                      className="border-b pb-2"
                      actions={
                        <Link to="/p/$projectId/runs" params={{ projectId }} className="text-xs font-normal text-muted-foreground underline hover:text-foreground">
                          전체 보기
                        </Link>
                      }
                    >
                      {activeCount > 0 ? `실행 중 ${activeCount}` : '최근 실행'}
                    </SectionHeading>
                    <div className="space-y-2">
                      {(activeCount > 0 ? progress.activeRuns : progress.recentRuns).length === 0 ? (
                        <p className="py-2 text-center text-xs text-muted-foreground">실행 기록이 없습니다.</p>
                      ) : (
                        (activeCount > 0 ? progress.activeRuns : progress.recentRuns).map((run) => {
                          const done = runDone(run);
                          const pct = run.total > 0 ? Math.round((done / run.total) * 100) : 0;
                          const hasFail = (run.states.failed ?? 0) > 0;
                          return (
                            <Link
                              key={run.id}
                              to="/p/$projectId/runs/$runId"
                              params={{ projectId, runId: run.id }}
                              className="block space-y-1 rounded p-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate">{run.workflowName}</span>
                                <Badge
                                  variant={
                                    run.status === 'running'
                                      ? 'default'
                                      : run.status === 'paused' || hasFail
                                        ? 'destructive'
                                        : 'secondary'
                                  }
                                  className="h-4 shrink-0 px-1 text-xs"
                                >
                                  {run.status === 'running'
                                    ? '실행 중'
                                    : run.status === 'paused'
                                      ? '일시정지'
                                      : run.status === 'completed'
                                        ? '완료'
                                        : '취소됨'}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <Progress value={pct} className="h-1 flex-1" />
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {done.toLocaleString()}/{run.total.toLocaleString()} ({pct}%)
                                </span>
                              </div>
                            </Link>
                          );
                        })
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 gap-1 rounded-none px-1.5 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="알림"
                  >
                    <Bell className="size-3" />
                    {hasNotification && (
                      <span className={cn('font-medium tabular-nums', failedRuns.length > 0 ? 'text-destructive' : 'text-primary')}>
                        {waiting > 0 ? waiting : '!'}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-80 p-3">
                  <div className="space-y-3">
                    <SectionHeading
                      as="h3"
                      className="border-b pb-2"
                      actions={
                        waiting > 0 ? (
                          <Badge variant="secondary" className="text-xs">
                            {waiting}건 대기
                          </Badge>
                        ) : undefined
                      }
                    >
                      알림
                    </SectionHeading>
                    {waiting > 0 && (
                      <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2.5">
                        <div className="flex items-center justify-between">
                          <GroupHeading>대기 중인 제안</GroupHeading>
                          <Badge variant="default" className="text-xs">
                            {waiting}건
                          </Badge>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-full text-xs"
                          onClick={() => {
                            setLastMode('agent');
                            setPropertiesOpen(true);
                            chatDock.set(true);
                          }}
                        >
                          에이전트 열기
                        </Button>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <GroupHeading
                        className="mb-0"
                        actions={
                          <Link to="/p/$projectId/runs" params={{ projectId }} className="text-xs font-normal text-muted-foreground underline hover:text-foreground">
                            실행 기록
                          </Link>
                        }
                      >
                        최근 실행
                      </GroupHeading>
                      {progress.recentRuns.length === 0 ? (
                        <p className="py-1 text-center text-xs text-muted-foreground">기록이 없습니다.</p>
                      ) : (
                        progress.recentRuns.slice(0, 3).map((run) => (
                          <Link
                            key={run.id}
                            to="/p/$projectId/runs/$runId"
                            params={{ projectId, runId: run.id }}
                            className="flex items-center justify-between rounded p-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <div className="flex min-w-0 items-center gap-1.5 truncate">
                              {run.status === 'completed' && (run.states.failed ?? 0) === 0 && <CheckCircle2 className="size-3 shrink-0 text-success" />}
                              {((run.states.failed ?? 0) > 0 || run.status === 'cancelled') && <TriangleAlert className="size-3 shrink-0 text-destructive" />}
                              {run.status === 'running' && <Spinner className="size-3 shrink-0 text-primary" />}
                              {run.status === 'paused' && <Play className="size-3 shrink-0 text-warning" />}
                              <span className="truncate">{run.workflowName}</span>
                            </div>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {dateTime(run.createdAt)}
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </AppStatusBar>
          </WorkspaceShell>
        </SidebarInset>
      </SidebarProvider>
    </DockProvider>
  );
}
