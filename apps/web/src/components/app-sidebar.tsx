import { useEffect } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Languages, Plus } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SECTIONS, useCurrentNav, type Section } from '@/lib/nav';
import { q } from '@/lib/queries';

/** Where each menu was left in this tab, so going back to a menu returns to that screen (sessionStorage, like drafts). */
const lastKey = (projectId: string, section: string) => `tw.nav.${projectId}.${section}`;
const readLast = (projectId: string, section: string): { pathname: string; search: Record<string, unknown> } | null => {
  try {
    return JSON.parse(sessionStorage.getItem(lastKey(projectId, section)) ?? 'null');
  } catch {
    return null;
  }
};

function SectionItem({ section, projectId, active, badge }: { section: Section; projectId: string; active: boolean; badge?: number }) {
  const first = section.tabs[0];
  const last = active ? null : readLast(projectId, section.id);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={section.label}>
        <Link {...((last ? { to: last.pathname, search: last.search } : { to: `/p/$projectId${first.path}`, params: { projectId }, search: first.search }) as unknown as { to: '/' })}>
          <section.icon />
          <span>{section.label}</span>
        </Link>
      </SidebarMenuButton>
      {!!badge && <SidebarMenuBadge title="검토 대기">{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

export function AppSidebar({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const projects = useQuery(q.projects());
  const project = useQuery(q.project(projectId));
  const info = projects.data?.find((item) => item.id === projectId);
  const current = useCurrentNav(projectId);
  const location = useRouterState({ select: (state) => state.location });
  const remembered = JSON.stringify({ pathname: location.pathname, search: location.search });
  useEffect(() => {
    try {
      sessionStorage.setItem(lastKey(projectId, current.section.id), remembered);
    } catch {
      /* private mode */
    }
  }, [projectId, current.section.id, remembered]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Languages className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{info?.name ?? '…'}</span>
                    <span className="truncate text-xs text-muted-foreground uppercase">
                      {info ? `${info.sourceLanguage} → ${info.targetLanguage}` : ''}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" align="start">
                <DropdownMenuLabel className="text-xs text-muted-foreground">프로젝트</DropdownMenuLabel>
                {projects.data?.map((item) => (
                  <DropdownMenuItem key={item.id} onSelect={() => void navigate({ to: '/p/$projectId', params: { projectId: item.id } })}>
                    <span className="truncate">{item.name}</span>
                    {item.id === projectId && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void navigate({ to: '/' })}>
                  <Plus /> 다른 프로젝트 가져오기
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {SECTIONS.filter((section) => section.id !== 'settings').map((section) => (
              <SectionItem key={section.id} section={section} projectId={projectId} active={section.id === current.section.id} badge={section.id === 'translate' ? project.data?.reviewCount : undefined} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SectionItem section={SECTIONS.find((section) => section.id === 'settings')!} projectId={projectId} active={current.section.id === 'settings'} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

