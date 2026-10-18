import { useEffect } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, Kbd, ResizableHandle, ResizablePanel, ResizablePanelGroup, Separator, SidebarInset, SidebarProvider, SidebarTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { ApiError } from '@/lib/api';
import { PanelRight, PanelRightClose } from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CommandSearch } from '@/components/command-search';
import { chatDock, useChatDockOpen } from '@/lib/chat-dock';
import { useChatUnread } from '@/lib/chat-unread';
import { q } from '@/lib/queries';
import { useJobNotices } from '@/lib/job-notices';
import { useCurrentNav } from '@/lib/nav';
import { keyLabel } from '@/lib/keys';
import { ShortcutHelp } from '@/components/shortcut-help';
import { HEADER_ACTIONS_ID } from '@/components/page';
import { AppStatusBar, StatusBar, STATUS_BAR_SLOT_ID } from '@loca/ui';
import { useProgress } from '@/lib/use-progress';

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
  useJobNotices(projectId);
  const layout = useDefaultLayout({ id: 'tw-main-chat', panelIds: chatOpen ? ['main', 'chat'] : ['main'], storage: localStorage });

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

  // Changes sent from the CLI wait in the chat panel: the chat button counts them so they are not missed while it is closed.
  const proposals = useQuery(q.proposals(projectId));
  const waiting = (proposals.data ?? []).filter((proposal) => proposal.status === 'pending').length;

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar projectId={projectId} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <ResizablePanel id="main" minSize="320px" className="flex min-w-0 flex-col">
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-2.5 select-none">
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger className="size-7" />
                </TooltipTrigger>
                <TooltipContent>메뉴 접기·펴기</TooltipContent>
              </Tooltip>
              <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
                {current.group.label ? <><span className="font-normal text-muted-foreground">{current.group.label} › </span>{current.item.label}</> : current.item.label}
              </h1>
              <div id={HEADER_ACTIONS_ID} className="ml-auto flex min-w-0 items-center gap-1.5 empty:hidden peer" />
              <Separator orientation="vertical" className="h-3.5 peer-empty:hidden" />
              <div className="ml-auto flex shrink-0 items-center gap-1 peer-[:not(:empty)]:ml-0">
                <CommandSearch projectId={projectId} />
                <ShortcutHelp />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={chatOpen ? 'secondary' : 'ghost'}
                      size="icon-sm"
                      onClick={chatDock.toggle}
                      aria-pressed={chatOpen}
                      aria-label={`에이전트 채팅${unread ? ' (새 답 있음)' : ''}${waiting ? ` (CLI 제안 ${waiting}개 대기)` : ''}`}
                      className="relative"
                    >
                      {chatOpen ? <PanelRightClose className="size-3.5" /> : <PanelRight className="size-3.5" />}
                      {waiting > 0 ? (
                        <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold leading-none text-primary-foreground tabular-nums ring-2 ring-background">
                          {waiting}
                        </span>
                      ) : (
                        unread && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {waiting > 0 && `CLI에서 온 제안 ${waiting}개가 수락을 기다립니다 · `}
                    {unread && '새 답이 왔습니다 · '}에이전트 채팅 {chatOpen ? '닫기' : '열기'} <Kbd>{keyLabel('Mod+I')}</Kbd>
                  </TooltipContent>
                </Tooltip>
              </div>
            </header>
            <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
              <Outlet />
            </main>
            <AppStatusBar>
              <StatusBar statuses={progress.statuses} counts={progress.counts} className="h-1 w-24 shrink-0" />
              <span className="whitespace-nowrap tabular-nums">확정 {progress.done.toLocaleString()}/{progress.total.toLocaleString()}</span>
              <div id={STATUS_BAR_SLOT_ID} className="min-w-0 flex-1 truncate" />
              {progress.runningRuns > 0 && <Link to="/p/$projectId/runs" params={{ projectId }} className="ml-auto whitespace-nowrap hover:text-foreground">실행 중 {progress.runningRuns}</Link>}
            </AppStatusBar>
          </ResizablePanel>
          {chatOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel id="chat" defaultSize="400px" minSize="300px" maxSize="75%" className="min-w-0 border-l border-border bg-panel">
                <ChatPanel projectId={projectId} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  );
}
