import { useRouterState } from '@tanstack/react-router';
import { BookOpenText, Cog, Home, Languages, Workflow, type LucideIcon } from 'lucide-react';

/** One screen inside a menu section: shown as a tab in the top bar. */
export interface SectionTab {
  label: string;
  /** Route path under /p/$projectId (no trailing slash). */
  path: string;
  /** Search params that tell this tab apart from another on the same path (자료 tabs). */
  search?: Record<string, string>;
  /** Other paths that belong to this tab (a run's detail under 실행 기록). */
  also?: string[];
}

export interface Section {
  id: 'home' | 'translate' | 'context' | 'automation' | 'settings';
  label: string;
  icon: LucideIcon;
  tabs: SectionTab[];
}

/**
 * The five menus, in the order the work goes: what to do next, translating and reviewing, the
 * context AI nodes read, the workflows that move lines, and settings. A menu's screens are tabs.
 */
export const SECTIONS: Section[] = [
  { id: 'home', label: '홈', icon: Home, tabs: [{ label: '홈', path: '' }] },
  {
    id: 'translate',
    label: '번역',
    icon: Languages,
    tabs: [
      { label: '대사', path: '/script', also: ['/reviews'] },
      { label: '그래프', path: '/graph' },
    ],
  },
  {
    id: 'context',
    label: '문맥',
    icon: BookOpenText,
    tabs: [
      { label: '문서', path: '/knowledge', search: { tab: 'documents' } },
      { label: '인물·관계', path: '/knowledge', search: { tab: 'people' } },
      { label: '사건', path: '/knowledge', search: { tab: 'events' } },
      { label: '용어집', path: '/glossary' },
    ],
  },
  {
    id: 'automation',
    label: '자동화',
    icon: Workflow,
    tabs: [
      { label: '워크플로', path: '/workflows' },
      { label: '실행 기록', path: '/runs' },
    ],
  },
  {
    id: 'settings',
    label: '설정',
    icon: Cog,
    tabs: [
      { label: '상태·태그', path: '/settings/statuses' },
      { label: 'AI 연결', path: '/settings/ai' },
      { label: 'AI 도구 권한', path: '/settings/agent' },
      { label: 'API 키', path: '/settings/keys' },
      { label: '프로젝트', path: '/settings/project' },
    ],
  },
];

const under = (rest: string, path: string) => (path === '' ? rest === '' : rest === path || rest.startsWith(`${path}/`));

/** The section and tab the current URL is in. 자료 without `tab` is its first tab (문서). */
export function useCurrentNav(projectId: string): { section: Section; tab: SectionTab } {
  const { pathname, search } = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as Record<string, unknown> }) });
  const rest = pathname.replace(`/p/${projectId}`, '').replace(/\/$/, '');
  for (const section of SECTIONS) {
    const onPath = section.tabs.filter((tab) => under(rest, tab.path) || tab.also?.some((path) => under(rest, path)));
    if (!onPath.length) continue;
    const exact = onPath.find((tab) => tab.search && Object.entries(tab.search).every(([key, value]) => search[key] === value));
    return { section, tab: exact ?? onPath[0] };
  }
  return { section: SECTIONS[0], tab: SECTIONS[0].tabs[0] };
}
