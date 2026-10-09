import { Link, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  BookMarked,
  BookOpenText,
  Check,
  ChevronsUpDown,
  Cpu,
  FileText,
  Inbox,
  LayoutDashboard,
  Network,
  Plus,
  Settings2,
  Tags,
  Workflow,
  History,
  Languages,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { q } from '@/lib/queries';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Inbox;
  exact?: boolean;
  badge?: number;
}

function NavGroup({ label, items, projectId }: { label?: string; items: NavItem[]; projectId: string }) {
  const matchRoute = useMatchRoute();
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton asChild isActive={Boolean(matchRoute({ to: item.to, params: { projectId }, fuzzy: !item.exact }))} tooltip={item.label}>
              <Link to={item.to} params={{ projectId }}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
            {!!item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function AppSidebar({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const projects = useQuery(q.projects());
  const project = useQuery(q.project(projectId));
  const current = projects.data?.find((item) => item.id === projectId);

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
                    <span className="truncate font-semibold">{current?.name ?? '…'}</span>
                    <span className="truncate text-xs text-muted-foreground uppercase">
                      {current ? `${current.sourceLanguage} → ${current.targetLanguage}` : ''}
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
        <NavGroup projectId={projectId} items={[{ to: '/p/$projectId', label: '개요', icon: LayoutDashboard, exact: true }]} />
        <NavGroup
          label="원문"
          projectId={projectId}
          items={[
            { to: '/p/$projectId/script', label: '스크립트', icon: FileText },
            { to: '/p/$projectId/graph', label: '그래프', icon: Network },
          ]}
        />
        <NavGroup
          label="자동화"
          projectId={projectId}
          items={[
            { to: '/p/$projectId/workflows', label: '워크플로', icon: Workflow },
            { to: '/p/$projectId/runs', label: '실행 기록', icon: History },
            { to: '/p/$projectId/reviews', label: '검토함', icon: Inbox, badge: project.data?.reviewCount },
          ]}
        />
        <NavGroup
          label="문맥"
          projectId={projectId}
          items={[
            { to: '/p/$projectId/knowledge', label: '자료', icon: BookOpenText },
            { to: '/p/$projectId/glossary', label: '용어집', icon: BookMarked },
          ]}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavGroup
          label="설정"
          projectId={projectId}
          items={[
            { to: '/p/$projectId/settings/statuses', label: '상태·태그', icon: Tags },
            { to: '/p/$projectId/settings/ai', label: 'AI', icon: Cpu },
            { to: '/p/$projectId/settings/project', label: '프로젝트', icon: Settings2 },
          ]}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

