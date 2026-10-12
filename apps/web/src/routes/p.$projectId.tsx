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
import { useCurrentNav } from '@/lib/nav';
import { cn } from '@/lib/utils';

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
          <ResizablePanel id="main" minSize="320px" className="flex min-w-0 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
              <SectionTabs projectId={projectId} />
              <div className="ml-auto flex items-center gap-1.5">
                <CommandSearch projectId={projectId} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant={chatOpen ? 'secondary' : 'ghost'} size="icon" onClick={chatDock.toggle} aria-pressed={chatOpen} aria-label="에이전트 채팅">
                      <MessageSquare />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    에이전트 채팅 {chatOpen ? '닫기' : '열기'} <Kbd>⌘I</Kbd>
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
  if (section.tabs.length === 1) return <h1 className="text-sm font-semibold">{section.label}</h1>;
  return (
    <nav className="flex h-full min-w-0 items-stretch gap-1" aria-label={section.label}>
      {section.tabs.map((tab) => (
        <Link
          key={tab.label}
          to={`/p/$projectId${tab.path}` as never}
          params={{ projectId } as never}
          search={tab.search as never}
          aria-current={tab === active ? 'page' : undefined}
          className={cn(
            'flex items-center border-y-2 border-t-transparent px-2 text-sm whitespace-nowrap transition-colors',
            tab === active ? 'border-b-foreground font-medium text-foreground' : 'border-b-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
