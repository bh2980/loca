import { useEffect } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check, ChevronsUpDown, Languages, Monitor, Moon, Plus, Settings2, Sun, Workflow } from 'lucide-react';
import { Sidebar, SidebarBrand, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuIcon, SidebarMenuItem, SidebarRail, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@loca/ui';
import { holds, NAV_GROUPS, useCurrentNav, type NavGroup, type NavItem } from '@/lib/nav';
import { q } from '@/lib/queries';
import { setTheme, useTheme, type ThemeChoice } from '@/lib/theme';

const lastKey = (projectId: string, itemId: string) => `tw.nav.${projectId}.${itemId}`;
const readLast = (projectId: string, itemId: string): { pathname: string; search: Record<string, unknown> } | null => {
  try { return JSON.parse(sessionStorage.getItem(lastKey(projectId, itemId)) ?? 'null'); } catch { return null; }
};

function ScreenItem({ navItem, projectId, active, badge }: { navItem: NavItem; projectId: string; active: boolean; badge?: number }) {
  const remembered = active ? null : readLast(projectId, navItem.id);
  const rest = remembered?.pathname.replace(`/p/${projectId}`, '').replace(/\/$/, '') ?? '';
  const last = remembered && holds(navItem, rest, remembered.search) ? remembered : null;
  const target = last ? { to: last.pathname, search: last.search } : { to: `/p/$projectId${navItem.path}`, params: { projectId }, search: navItem.search };
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={navItem.label} className={active ? 'data-[active=true]:font-medium' : undefined}>
        <Link activeOptions={{ exact: navItem.id === 'home' }} aria-current={active ? 'page' : undefined} {...(target as unknown as { to: '/' })}>
          <SidebarMenuIcon className={navItem.id === 'home' ? undefined : 'hidden group-data-[collapsible=icon]:flex'}><navItem.icon /></SidebarMenuIcon>
          <span className={navItem.id === 'home' ? 'truncate' : 'ml-6 truncate group-data-[collapsible=icon]:ml-0'}>{navItem.label}</span>
        </Link>
      </SidebarMenuButton>
      {!!badge && <SidebarMenuBadge title="검토 대기">{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function SettingsItem({ navItem, projectId, active }: { navItem: NavItem; projectId: string; active: boolean }) {
  const remembered = active ? null : readLast(projectId, navItem.id);
  const rest = remembered?.pathname.replace(`/p/${projectId}`, '').replace(/\/$/, '') ?? '';
  const last = remembered && holds(navItem, rest, remembered.search) ? remembered : null;
  const target = last ? { to: last.pathname, search: last.search } : { to: `/p/$projectId${navItem.path}`, params: { projectId }, search: navItem.search };
  return <DropdownMenuItem asChild>
    <Link activeOptions={{ exact: false }} aria-current={active ? 'page' : undefined} {...(target as unknown as { to: '/' })}>
      <navItem.icon />
      <span className="truncate">{navItem.label}</span>
      {active && <Check className="ml-auto" />}
    </Link>
  </DropdownMenuItem>;
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '밝게', icon: Sun }, { value: 'dark', label: '어둡게', icon: Moon }, { value: 'system', label: '시스템 설정', icon: Monitor },
];

const GROUP_ICONS = { translate: Languages, knowledge: BookOpen, automation: Workflow };

export function AppSidebar({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const projects = useQuery(q.projects());
  const project = useQuery(q.project(projectId));
  const info = projects.data?.find((entry) => entry.id === projectId);
  const current = useCurrentNav(projectId);
  const location = useRouterState({ select: (state) => state.location });
  const remembered = JSON.stringify({ pathname: location.pathname, search: location.search });
  useEffect(() => {
    try { sessionStorage.setItem(lastKey(projectId, current.item.id), remembered); } catch { /* private mode */ }
  }, [projectId, current.item.id, remembered]);
  const renderGroup = (group: NavGroup) => {
    const settings = group.id === 'settings';
    const contents = <SidebarMenu>{group.items.map((navItem) => <ScreenItem key={navItem.id} navItem={navItem} projectId={projectId} active={current.item.id === navItem.id} badge={navItem.id === 'script' ? project.data?.reviewCount : undefined} />)}</SidebarMenu>;
    if (!group.label) return <SidebarGroup key={group.id} className="py-1">{contents}</SidebarGroup>;
    if (settings) return <SidebarGroup key={group.id} className="p-0"><SidebarMenu><SidebarMenuItem><DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton isActive={current.group.id === 'settings'} aria-label="설정" title="설정">
          <SidebarMenuIcon><Settings2 /></SidebarMenuIcon>
          <span className="group-data-[collapsible=icon]:hidden">{group.label}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="max-h-[calc(100svh-2rem)] w-64 overflow-y-auto">
        <DropdownMenuLabel>설정</DropdownMenuLabel>
        {group.items.map((navItem) => <SettingsItem key={navItem.id} navItem={navItem} projectId={projectId} active={current.item.id === navItem.id} />)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground">화면 테마</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)}>
          {THEMES.map((entry) => <DropdownMenuRadioItem key={entry.value} value={entry.value} className="h-7"><entry.icon /> {entry.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu></SidebarMenuItem></SidebarMenu></SidebarGroup>;
    const GroupIcon = GROUP_ICONS[group.id as keyof typeof GROUP_ICONS];
    return <SidebarGroup key={group.id} className="py-2"><SidebarGroupLabel icon={GroupIcon ? <GroupIcon /> : undefined} className="text-subtle-foreground">{group.label}</SidebarGroupLabel>{contents}</SidebarGroup>;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader><SidebarMenu><SidebarMenuItem><DropdownMenu>
        <DropdownMenuTrigger asChild><SidebarBrand compactMark={info?.name?.trim().charAt(0) || 'P'} title={info?.name ?? '…'} detail={info ? `${info.sourceLanguage} → ${info.targetLanguage}` : undefined} end={<ChevronsUpDown className="ml-auto size-4" />} /></DropdownMenuTrigger>
        <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" align="start">
          <DropdownMenuLabel className="text-xs font-semibold text-foreground">프로젝트</DropdownMenuLabel>
          {projects.data?.map((entry) => <DropdownMenuItem key={entry.id} onSelect={() => void navigate({ to: '/p/$projectId', params: { projectId: entry.id } })}><span className="truncate">{entry.name}</span>{entry.id === projectId && <Check className="ml-auto" />}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void navigate({ to: '/' })}><Plus /> 프로젝트 가져오기</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu></SidebarMenuItem></SidebarMenu></SidebarHeader>
      <SidebarContent>{NAV_GROUPS.filter((group) => group.id !== 'settings').map(renderGroup)}</SidebarContent>
      <SidebarFooter><SidebarGroup className="p-0">{renderGroup(NAV_GROUPS.find((group) => group.id === 'settings')!)}</SidebarGroup></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
