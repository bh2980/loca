import { DockProvider, DockInspector, DockHeader, WorkspaceShell, PageHeader } from '@loca/ui';
import { useEffect, useState } from 'react';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle, Button, SidebarInset, SidebarProvider, SidebarTrigger } from '@loca/ui';
import { ApiError } from '@/lib/api';
import { AppSidebar } from '@/components/app-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CommandSearch } from '@/components/command-search';
import { chatDock, useChatDockOpen } from '@/lib/chat-dock';
import { useChatUnread } from '@/lib/chat-unread';
import { q } from '@/lib/queries';
import { useJobNotices } from '@/lib/job-notices';
import { useCurrentNav } from '@/lib/nav';
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
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const open = chatOpen || propertiesOpen;
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
    setPropertiesOpen(true);
    chatDock.set(mode === 'agent');
  };
  const toggleDock = () => {
    setPropertiesOpen(!open);
    if (open) chatDock.set(false);
  };
  return (
    <DockProvider>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar projectId={projectId} />
        <SidebarInset className="min-w-0 overflow-hidden">
          <WorkspaceShell open={open} onOpenChange={(next) => { setPropertiesOpen(next); if (!next) chatDock.set(false); }} dock={<>
            <DockHeader mode={chatOpen ? 'agent' : 'properties'} onMode={changeMode} onToggle={toggleDock} unread={unread || waiting > 0} tools={<CommandSearch projectId={projectId} compact />} />
            <div className={chatOpen ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}><DockInspector /></div>
            <div className={chatOpen ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><ChatPanel projectId={projectId} /></div>
          </>}>
            <PageHeader title={current.item.label} leading={<SidebarTrigger />} tools={!open && <DockHeader mode="properties" onMode={changeMode} onToggle={toggleDock} open={false} tools={<CommandSearch projectId={projectId} compact />} />} />
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"><Outlet /></main>
            <AppStatusBar>
              <StatusBar statuses={progress.statuses} counts={progress.counts} className="h-1 w-24 shrink-0" />
              <span className="whitespace-nowrap tabular-nums">확정 {progress.done.toLocaleString()}/{progress.total.toLocaleString()}</span>
              <div id={STATUS_BAR_SLOT_ID} className="min-w-0 flex-1 truncate" />
              {progress.runningRuns > 0 && <Link to="/p/$projectId/runs" params={{ projectId }} className="ml-auto whitespace-nowrap hover:text-foreground">실행 중 {progress.runningRuns}</Link>}
            </AppStatusBar>
          </WorkspaceShell>
        </SidebarInset>
      </SidebarProvider>
    </DockProvider>
  );
}
