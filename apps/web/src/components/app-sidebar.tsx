import { useEffect } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check, Languages, Monitor, Moon, Plus, Settings2, Sun, Workflow } from 'lucide-react';
import { Sidebar, SidebarBrand, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuIcon, SidebarMenuItem, SidebarRail, DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuTrigger, BrandSwitchIcon, HiddenWhenCollapsed, Icon, MenuHeadingLabel, MutedMenuLabel, NavGroupLabel, ProjectMenuContent, ScreenMenuButton, ScreenMenuIcon, ScreenMenuLabel, SettingsMenuContent, SidebarNavGroup, Text, ThemeRadioItem } from '@loca/ui';
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
      <ScreenMenuButton asChild isActive={active} tooltip={navItem.label}>
        <Link activeOptions={{ exact: navItem.id === 'home' }} aria-current={active ? 'page' : undefined} {...(target as unknown as { to: '/' })}>
          <ScreenMenuIcon always={navItem.id === 'home'}><navItem.icon /></ScreenMenuIcon>
          <ScreenMenuLabel indented={navItem.id !== 'home'}>{navItem.label}</ScreenMenuLabel>
        </Link>
      </ScreenMenuButton>
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
      <Text truncate>{navItem.label}</Text>
      {active && <Icon icon={Check} marginLeft="auto" />}
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
    if (!group.label) return <SidebarNavGroup key={group.id} inset="tight">{contents}</SidebarNavGroup>;
    if (settings) return <SidebarNavGroup key={group.id} inset="none"><SidebarMenu><SidebarMenuItem><DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton isActive={current.group.id === 'settings'} aria-label="설정" title="설정">
          <SidebarMenuIcon><Settings2 /></SidebarMenuIcon>
          <HiddenWhenCollapsed>{group.label}</HiddenWhenCollapsed>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <SettingsMenuContent side="top" align="start">
        <DropdownMenuLabel>설정</DropdownMenuLabel>
        {group.items.map((navItem) => <SettingsItem key={navItem.id} navItem={navItem} projectId={projectId} active={current.item.id === navItem.id} />)}
        <DropdownMenuSeparator />
        <MutedMenuLabel>화면 테마</MutedMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)}>
          {THEMES.map((entry) => <ThemeRadioItem key={entry.value} value={entry.value}><entry.icon /> {entry.label}</ThemeRadioItem>)}
        </DropdownMenuRadioGroup>
      </SettingsMenuContent>
    </DropdownMenu></SidebarMenuItem></SidebarMenu></SidebarNavGroup>;
    const GroupIcon = GROUP_ICONS[group.id as keyof typeof GROUP_ICONS];
    return <SidebarNavGroup key={group.id} inset="condensed"><NavGroupLabel icon={GroupIcon ? <GroupIcon /> : undefined}>{group.label}</NavGroupLabel>{contents}</SidebarNavGroup>;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader><SidebarMenu><SidebarMenuItem><DropdownMenu>
        <DropdownMenuTrigger asChild><SidebarBrand compactMark={info?.name?.trim().charAt(0) || 'P'} title={info?.name ?? '…'} detail={info ? `${info.sourceLanguage} → ${info.targetLanguage}` : undefined} end={<BrandSwitchIcon />} /></DropdownMenuTrigger>
        <ProjectMenuContent align="start">
          <MenuHeadingLabel>프로젝트</MenuHeadingLabel>
          {projects.data?.map((entry) => <DropdownMenuItem key={entry.id} onSelect={() => void navigate({ to: '/p/$projectId', params: { projectId: entry.id } })}><Text truncate>{entry.name}</Text>{entry.id === projectId && <Icon icon={Check} marginLeft="auto" />}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void navigate({ to: '/' })}><Plus /> 프로젝트 가져오기</DropdownMenuItem>
        </ProjectMenuContent>
      </DropdownMenu></SidebarMenuItem></SidebarMenu></SidebarHeader>
      <SidebarContent>{NAV_GROUPS.filter((group) => group.id !== 'settings').map(renderGroup)}</SidebarContent>
      <SidebarFooter><SidebarNavGroup inset="none">{renderGroup(NAV_GROUPS.find((group) => group.id === 'settings')!)}</SidebarNavGroup></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
