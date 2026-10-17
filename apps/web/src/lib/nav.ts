import { useRouterState } from '@tanstack/react-router';
import { BookOpenText, Bot, Cog, Home, Languages, Sparkles, Workflow, type LucideIcon } from 'lucide-react';

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
  id: 'home' | 'translate' | 'knowledge' | 'workflows' | 'ai' | 'agent' | 'settings';
  label: string;
  /** The sidebar's block: the home, the work on the text, what automates it; settings sit at the bottom. */
  group: 'home' | 'text' | 'automation' | 'settings';
  icon: LucideIcon;
  tabs: SectionTab[];
}

/**
 * The menus, in the order the work goes (#48): what to do next; translating (lines, graph and the
 * glossary that goes with them) and 자료, the knowledge AI nodes read; the workflows that move lines
 * (API 키 is theirs: the HTTP call node), the AI they call (connections, how AI results land) and the
 * chat agent's own page (its tools and default permission mode); settings. A menu's screens are tabs.
 */
export const SECTIONS: Section[] = [
  { id: 'home', label: '홈', group: 'home', icon: Home, tabs: [{ label: '홈', path: '' }] },
  {
    id: 'translate',
    label: '번역',
    group: 'text',
    icon: Languages,
    tabs: [
      { label: '대사', path: '/script', also: ['/reviews'] },
      { label: '그래프', path: '/graph' },
      { label: '용어집', path: '/glossary' },
    ],
  },
  {
    id: 'knowledge',
    label: '자료',
    group: 'text',
    icon: BookOpenText,
    tabs: [
      { label: '문서', path: '/knowledge', search: { tab: 'documents' } },
      { label: '인물·관계', path: '/knowledge', search: { tab: 'people' } },
      { label: '사건', path: '/knowledge', search: { tab: 'events' } },
    ],
  },
  {
    id: 'workflows',
    label: '워크플로',
    group: 'automation',
    icon: Workflow,
    tabs: [
      { label: '워크플로', path: '/workflows' },
      { label: '실행 기록', path: '/runs' },
      // Only the HTTP call node uses these (AI connections keep their own key).
      { label: 'API 키', path: '/keys' },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    group: 'automation',
    icon: Sparkles,
    tabs: [
      { label: '연결', path: '/ai/connections' },
      { label: '사용 방식', path: '/ai/usage' },
    ],
  },
  { id: 'agent', label: '에이전트', group: 'automation', icon: Bot, tabs: [{ label: '에이전트', path: '/agent' }] },
  {
    id: 'settings',
    label: '설정',
    group: 'settings',
    icon: Cog,
    tabs: [
      { label: '프로젝트', path: '/settings/project' },
      { label: '상태·태그', path: '/settings/statuses' },
    ],
  },
];

const under = (rest: string, path: string) => (path === '' ? rest === '' : rest === path || rest.startsWith(`${path}/`));

/** Whether a path under /p/$projectId is one of the section's screens (a remembered one may have moved since). */
export const holds = (section: Section, rest: string) => section.tabs.some((tab) => under(rest, tab.path) || tab.also?.some((path) => under(rest, path)));

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
