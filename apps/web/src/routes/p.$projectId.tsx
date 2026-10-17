import { useEffect } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, Kbd, ResizableHandle, ResizablePanel, ResizablePanelGroup, Separator, SidebarInset, SidebarProvider, SidebarTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { ApiError } from '@/lib/api';
import { MessageSquare } from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CommandSearch } from '@/components/command-search';
import { chatDock, useChatDockOpen } from '@/lib/chat-dock';
import { useChatUnread } from '@/lib/chat-unread';
import { q } from '@/lib/queries';
import { useJobNotices } from '@/lib/job-notices';
import { useCurrentNav } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { keyLabel } from '@/lib/keys';
import { ShortcutHelp } from '@/components/shortcut-help';
import { HEADER_ACTIONS_ID } from '@/components/page';

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
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/80 bg-surface-2/70 px-2.5 backdrop-blur-xs select-none">
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger className="size-7" />
                </TooltipTrigger>
                <TooltipContent>메뉴 접기·펴기</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="mr-1 h-3.5" />
              <SectionTabs projectId={projectId} />
              <div className="ml-auto flex items-center gap-1">
                <div id={HEADER_ACTIONS_ID} className="mr-1 flex items-center gap-1.5 empty:hidden" />
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
                      <MessageSquare className="size-3.5" />
                      {waiting > 0 ? (
                        <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-indigo px-1 text-xs font-bold leading-none text-white tabular-nums ring-2 ring-background">
                          {waiting}
                        </span>
                      ) : (
                        unread && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent-indigo ring-2 ring-background" />
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
            <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-canvas">
              <Outlet />
            </main>
          </ResizablePanel>
          {chatOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel id="chat" defaultSize="400px" minSize="300px" maxSize="75%" className="min-w-0">
                <ChatPanel projectId={projectId} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** The current menu's screens as tabs; a menu with one screen shows its name. */
function SectionTabs({ projectId }: { projectId: string }) {
  const { section, tab: active } = useCurrentNav(projectId);
  if (section.tabs.length === 1) return <h1 className="px-1.5 text-xs font-semibold text-foreground">{section.label}</h1>;
  return (
    <nav className="flex h-full min-w-0 items-stretch gap-0.5" aria-label={section.label}>
      {section.tabs.map((tab) => {
        const isCurrent = tab === active;
        return (
          <Link
            key={tab.label}
            to={`/p/$projectId${tab.path}` as never}
            params={{ projectId } as never}
            search={tab.search as never}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'relative flex items-center px-2.5 text-xs font-medium whitespace-nowrap transition-colors select-none',
              isCurrent
                ? 'text-foreground font-semibold after:absolute after:bottom-0 after:inset-x-2 after:h-[2px] after:bg-foreground after:rounded-full'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-1/60 rounded-md'
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
