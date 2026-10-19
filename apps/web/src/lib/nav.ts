import { useRouterState } from '@tanstack/react-router';
import { BookMarked, Bot, FileText, GitBranch, History, Home, Languages, Milestone, PenLine, Plug, Settings2, Sparkles, Tags, UsersRound, Workflow, type LucideIcon } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  search?: Record<string, string>;
  also?: string[];
  groupId: 'home' | 'translate' | 'knowledge' | 'automation' | 'settings';
  groupLabel: string;
}

export interface NavGroup {
  id: NavItem['groupId'];
  label: string;
  items: NavItem[];
}

const item = (id: NavItem['id'], label: string, path: string, icon: LucideIcon, groupId: NavItem['groupId'], groupLabel: string, extra: Partial<NavItem> = {}): NavItem => ({ id, label, path, icon, groupId, groupLabel, ...extra });

export const NAV_GROUPS: NavGroup[] = [
  { id: 'home', label: '', items: [item('home', '홈', '', Home, 'home', '')] },
  { id: 'translate', label: '번역', items: [
    item('script', '대사', '/script', Languages, 'translate', '번역', { also: ['/reviews'] }),
    item('graph', '그래프', '/graph', GitBranch, 'translate', '번역'),
    item('glossary', '용어집', '/glossary', BookMarked, 'translate', '번역'),
  ] },
  { id: 'knowledge', label: '자료', items: [
    item('people', '인물·관계', '/knowledge', UsersRound, 'knowledge', '자료', { search: { tab: 'people' } }),
    item('documents', '문서', '/knowledge', FileText, 'knowledge', '자료', { search: { tab: 'documents' } }),
    item('events', '사건', '/knowledge', Milestone, 'knowledge', '자료', { search: { tab: 'events' } }),
  ] },
  { id: 'automation', label: '자동화', items: [
    item('workflows', '워크플로', '/workflows', Workflow, 'automation', '자동화'),
    item('runs', '실행 기록', '/runs', History, 'automation', '자동화'),
  ] },
  { id: 'settings', label: '설정', items: [
    item('project-settings', '프로젝트', '/settings/project', Settings2, 'settings', '설정'),
    item('statuses', '상태·태그', '/settings/statuses', Tags, 'settings', '설정'),
    item('editor-settings', '에디터', '/settings/editor', PenLine, 'settings', '설정', { also: ['/ai/usage'] }),
    item('chat-settings', '채팅', '/settings/chat', Bot, 'settings', '설정'),
    item('connections', '연결', '/settings/connections', Plug, 'settings', '설정', { also: ['/ai/connections', '/keys'] }),
  ] },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
const under = (rest: string, path: string) => (path === '' ? rest === '' : rest === path || rest.startsWith(`${path}/`));

export function holds(item: NavItem, rest: string, search: Record<string, unknown> = {}) {
  const matchesPath = under(rest, item.path) || item.also?.some((path) => under(rest, path));
  if (!matchesPath) return false;
  if (item.search && !Object.entries(item.search).every(([key, value]) => search[key] === value)) {
    if (!(item.id === 'documents' && rest === '/knowledge' && search.tab == null)) return false;
  }
  return true;
}

export function useCurrentNav(projectId: string): { group: NavGroup; item: NavItem } {
  const { pathname, search } = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as Record<string, unknown> }) });
  const rest = pathname.replace(`/p/${projectId}`, '').replace(/\/$/, '');
  const selected = NAV_ITEMS.find((entry) => holds(entry, rest, search)) ?? NAV_ITEMS[0];
  const group = NAV_GROUPS.find((entry) => entry.id === selected.groupId)!;
  return { group, item: selected };
}
