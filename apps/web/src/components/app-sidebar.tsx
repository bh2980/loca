import { memo, useEffect } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { BookOpen, Check, ChevronsUpDown, Languages, Monitor, Moon, Plus, Settings, Sun, Workflow } from 'lucide-react';
import { Sidebar, SidebarBrand, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuIcon, SidebarMenuItem, SidebarRail, useSidebar, DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuRadioItem, Icon, SidebarGroup, SidebarGroupLabel, SidebarMenuLabel, Text, DropdownMenuContent, MenuLabel, PersonAvatar } from '@loca/ui';
import { holds, NAV_GROUPS, useCurrentNav, type NavGroup, type NavItem } from '@/lib/nav';
import { setTheme, useTheme, type ThemeChoice } from '@/lib/theme';
import { useProjectProgress } from '@/lib/project';
import { useProfile, useProjects } from '@/lib/app-data';
import { stored, STORED } from '@/lib/storage';
import { useShortcuts } from '@/lib/shortcuts';

const readLast = (projectId: string, itemId: string) => stored(STORED.sidebarLast, projectId, itemId).read();

/** 검토 대기 on 대사: its own reader of the project's counts, so a count that moves redraws only this number. */
function ReviewBadge({ projectId }: { projectId: string }) {
  const reviewCount = useProjectProgress(projectId)?.reviewCount;
  return reviewCount ? <SidebarMenuBadge title="검토 대기">{reviewCount}</SidebarMenuBadge> : null;
}

/**
 * Where each screen was left, remembered as the URL changes. It renders nothing: the URL changes with every selection, and only
 * this listens to all of it (the sidebar itself redraws when the screen changes, not when a line is picked).
 */
function RememberScreen({ projectId, itemId }: { projectId: string; itemId: string }) {
  const remembered = useRouterState({ select: (state) => JSON.stringify({ pathname: state.location.pathname, search: state.location.search }) });
  useEffect(() => {
    stored(STORED.sidebarLast, projectId, itemId).write(JSON.parse(remembered) as { pathname: string; search: Record<string, unknown> });
  }, [projectId, itemId, remembered]);
  return null;
}

const ScreenItem = memo(function ScreenItem({ navItem, projectId, active }: { navItem: NavItem; projectId: string; active: boolean }) {
  const remembered = active ? null : readLast(projectId, navItem.id);
  const rest = remembered?.pathname.replace(`/p/${projectId}`, '').replace(/\/$/, '') ?? '';
  const last = remembered && holds(navItem, rest, remembered.search) ? remembered : null;
  const target = last ? { to: last.pathname, search: last.search } : { to: `/p/$projectId${navItem.path}`, params: { projectId }, search: navItem.search };
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} activeWeight="medium" tooltip={navItem.label}>
        <Link activeOptions={{ exact: navItem.id === 'home' }} aria-current={active ? 'page' : undefined} {...(target as unknown as { to: '/' })}>
          <SidebarMenuIcon collapsedOnly={navItem.id !== 'home'}><navItem.icon /></SidebarMenuIcon>
          <SidebarMenuLabel placement={navItem.id !== 'home' ? 'indented' : 'plain'}>{navItem.label}</SidebarMenuLabel>
        </Link>
      </SidebarMenuButton>
      {navItem.id === 'script' && <ReviewBadge projectId={projectId} />}
    </SidebarMenuItem>
  );
});

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

/**
 * The project's name and the menu to change project. It reads the projects list itself: a project row changes whenever its
 * lines are saved (its update time), and that redraws this header, not the whole sidebar.
 */
function ProjectSwitcher({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const info = projects.data?.find((entry) => entry.id === projectId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><SidebarBrand compactMark={info?.name?.trim().charAt(0) || 'P'} title={info?.name ?? '…'} detail={info ? `${info.sourceLanguage} → ${info.targetLanguage}` : undefined} end={<Icon icon={ChevronsUpDown} size="md" marginLeft="auto" />} /></DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="trigger">
        <MenuLabel tone="strong">프로젝트</MenuLabel>
        {projects.data?.map((entry) => <DropdownMenuItem key={entry.id} onSelect={() => void navigate({ to: '/p/$projectId', params: { projectId: entry.id } })}><Text truncate>{entry.name}</Text>{entry.id === projectId && <Icon icon={Check} marginLeft="auto" />}</DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate({ to: '/' })}><Plus /> 프로젝트 가져오기</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar({ projectId }: { projectId: string }) {
  const { toggleSidebar } = useSidebar();
  useShortcuts({ sidebar: toggleSidebar });
  const theme = useTheme();
  const profile = useProfile();
  const current = useCurrentNav(projectId);
  const renderGroup = (group: NavGroup) => {
    const settings = group.id === 'settings';
    const contents = <SidebarMenu>{group.items.map((navItem) => <ScreenItem key={navItem.id} navItem={navItem} projectId={projectId} active={current.item.id === navItem.id} />)}</SidebarMenu>;
    if (!group.label) return <SidebarGroup key={group.id} inset="tight">{contents}</SidebarGroup>;
    // The footer pads it already: none here lines its icon up with 홈 at the top.
    if (settings) return <SidebarGroup key={group.id} inset="none"><SidebarMenu><SidebarMenuItem><DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* 설정 at the foot, drawn like 홈 at the top: the profile, every setting and the theme open from it. */}
        <SidebarMenuButton isActive={current.group.id === 'settings'} activeWeight="medium" tooltip="설정">
          <SidebarMenuIcon><Settings /></SidebarMenuIcon>
          <SidebarMenuLabel placement="plain">설정</SidebarMenuLabel>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width="menu-lg" maxHeight="dialog">
        <DropdownMenuItem asChild><Link to="/settings/profile"><PersonAvatar mark={profile.mark} color={profile.color} /> 프로필 편집</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>설정</DropdownMenuLabel>
        {group.items.map((navItem) => <SettingsItem key={navItem.id} navItem={navItem} projectId={projectId} active={current.item.id === navItem.id} />)}
        <DropdownMenuSeparator />
        <MenuLabel>화면 테마</MenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)}>
          {THEMES.map((entry) => <DropdownMenuRadioItem key={entry.value} value={entry.value} compact><entry.icon /> {entry.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu></SidebarMenuItem></SidebarMenu></SidebarGroup>;
    const GroupIcon = GROUP_ICONS[group.id as keyof typeof GROUP_ICONS];
    return <SidebarGroup key={group.id} inset="condensed"><SidebarGroupLabel icon={GroupIcon ? <GroupIcon /> : undefined}>{group.label}</SidebarGroupLabel>{contents}</SidebarGroup>;
  };

  return (
    <Sidebar collapsible="icon">
      <RememberScreen projectId={projectId} itemId={current.item.id} />
      <SidebarHeader><SidebarMenu><SidebarMenuItem><ProjectSwitcher projectId={projectId} /></SidebarMenuItem></SidebarMenu></SidebarHeader>
      <SidebarContent>{NAV_GROUPS.filter((group) => group.id !== 'settings').map(renderGroup)}</SidebarContent>
      <SidebarFooter>{renderGroup(NAV_GROUPS.find((group) => group.id === 'settings')!)}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
