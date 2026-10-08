import { useEffect } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ApiError } from '@/lib/api';
import { MessageSquare } from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CommandSearch } from '@/components/command-search';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { chatDock, useChatDockOpen } from '@/lib/chat-dock';
import { q } from '@/lib/queries';
import { useViewState } from '@/lib/view-context';

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
  const view = useViewState();
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

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar projectId={projectId} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <ResizablePanel id="main" minSize="420px" className="flex min-w-0 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
              <span className="truncate text-sm text-muted-foreground">{view.page}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <CommandSearch projectId={projectId} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant={chatOpen ? 'secondary' : 'ghost'} size="sm" onClick={chatDock.toggle} aria-pressed={chatOpen}>
                      <MessageSquare /> 에이전트
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    채팅 열기/닫기 <Kbd>⌘I</Kbd>
                  </TooltipContent>
                </Tooltip>
              </div>
            </header>
            <main className="flex min-h-0 flex-1 flex-col overflow-auto">
              <Outlet />
            </main>
          </ResizablePanel>
          {chatOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel id="chat" defaultSize="400px" minSize="320px" maxSize="720px" className="min-w-0">
                <ChatPanel projectId={projectId} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  );
}
