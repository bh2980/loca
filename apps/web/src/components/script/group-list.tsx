import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LineMark } from '@tw/shared';
import { Link } from '@tanstack/react-router';
import { AppWindow, Check, FileText, Inbox, MessageSquareText } from 'lucide-react';
import { SearchInput, NavigationBranch, NavigationItem, NavigationPane, StatusBar, commonNavigationItem, type StatusLike } from '@loca/ui';
import { GROUP_KIND, SCRIPT_VIEW, SOURCE_GROUP_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

export interface GroupRow {
  id: string;
  kind: keyof typeof GROUP_KIND;
  title: string;
  key: string;
  section: string | null;
  sort: number;
  total: number;
  statuses: Record<string, number>;
  unknownListeners: number;
}

/** Sections start closed by default; explicit unfolds are a per-tab convenience, like the graph viewport. */
const storageKey = (projectId: string) => `tw.script.expanded.${projectId}`;
const readExpanded = (projectId: string): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(projectId)) ?? '[]');
  } catch {
    return [];
  }
};

/** Consecutive groups of the same section, in script order. */
function sectionsOf(groups: GroupRow[]) {
  const sections: { key: string; name: string | null; groups: GroupRow[] }[] = [];
  for (const group of [...groups].sort((a, b) => a.sort - b.sort)) {
    const last = sections.at(-1);
    if (last && last.name === group.section) last.groups.push(group);
    else sections.push({ key: `${sections.length}:${group.section ?? ''}`, name: group.section, groups: [group] });
  }
  return sections;
}

export type ScriptScope = { group?: string; review?: true; kind?: GroupRow['kind']; section?: string };

const VIEW_ICON = { scene: <MessageSquareText />, ui: <AppWindow />, document: <FileText /> };

/**
 * Source kinds and chapter navigation down the left of the translation screen, with review pinned below.
 * Each scene shows only how many of its lines are done (in a final status), or a check when all are.
 */
export function GroupList({ projectId, groups, finalIds, initialIds, scope, reviewCount, gq, onFilter, marks, views, statuses }: {
  projectId: string;
  groups: GroupRow[] | undefined;
  /** Statuses that count as done. */
  finalIds: Set<string>;
  /** 미번역 and the like: a line past these has been started (translated at least once). */
  initialIds: Set<string>;
  scope: ScriptScope;
  reviewCount: number;
  gq?: string;
  onFilter: (gq: string | undefined) => void;
  /** While a filter is walked (찾아가기): how many of its lines each scene holds; scenes keep the filter. */
  marks?: Map<string, number>;
  /** The views when the project has more than one kind (대사 · UI · 문서), with their line counts; `groups` are the open view's. */
  views?: { kind: GroupRow['kind']; lines: number }[];
  /** Project status definitions used to color each scene's actual per-status counts. */
  statuses?: StatusLike[];
}) {
  const sections = useMemo(() => sectionsOf(groups ?? []), [groups]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readExpanded(projectId)));
  const toggle = (name: string, open: boolean) =>
    setExpanded((previous) => {
      if (previous.has(name) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(name);
      else next.delete(name);
      try {
        sessionStorage.setItem(storageKey(projectId), JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
      return next;
    });
  // A scene's count is its progress: lines translated (past 미번역), with 확정 named in the hint; the check means all 확정.
  const progressOf = (group: GroupRow) => {
    const lines = Object.entries(group.statuses);
    return { translated: lines.reduce((sum, [id, n]) => sum + (initialIds.has(id) ? 0 : n), 0), final: lines.reduce((sum, [id, n]) => sum + (finalIds.has(id) ? n : 0), 0) };
  };

  const search = <SearchInput value={gq} onChange={onFilter} placeholder={`${SOURCE_GROUP_LABEL[scope.kind ?? 'scene']} 찾기`} className="w-full" />;
  const kindsNav = (
    <nav aria-label="원본 종류" className="space-y-1">
      {views?.map((view) => <ScopeLink key={view.kind} projectId={projectId} scope={{ kind: view.kind }} clearPeopleFilters={view.kind !== scope.kind} active={!scope.group && !scope.section && !scope.review && scope.kind === view.kind} icon={VIEW_ICON[view.kind]} label={`전체 ${SCRIPT_VIEW[view.kind]}`} count={view.lines} />)}
    </nav>
  );
  const reviewNav = <ScopeLink projectId={projectId} scope={{ review: true }} active={Boolean(scope.review)} icon={<Inbox />} label="검토함" count={reviewCount} highlight={reviewCount > 0} />;

  return (
    <NavigationPane search={<div className="space-y-2">{kindsNav}{search}</div>} footer={reviewNav}>
        {!groups && <p className="px-3 py-2 text-xs text-muted-foreground">불러오는 중…</p>}
        {groups?.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">맞는 항목이 없습니다.</p>}
        {sections.map((section) => {
          // A scene search shows its matches wherever they are; otherwise sections default to closed unless opened or active.
          const open = Boolean(gq) || !section.name || expanded.has(section.name);
          const items = section.groups.map((group) => <GroupItem key={group.id} projectId={projectId} group={group} progress={progressOf(group)} statuses={statuses} active={group.id === scope.group} indent={Boolean(section.name)} marks={marks} />);
          if (!section.name) return <Fragment key={section.key}>{items}</Fragment>;
          const count = section.groups.reduce((sum, group) => sum + group.total, 0);
          const active = scope.section === section.name;
          return <NavigationBranch key={section.key} label={section.name} open={open} onOpenChange={(next) => toggle(section.name!, next)} disabled={Boolean(gq)} navigation={
              <ScriptLink projectId={projectId} scope={{ kind: scope.kind, section: section.name }} aria-current={active ? 'page' : undefined} className={commonNavigationItem(active, 'min-w-0 flex-1')}>
                <span className="min-w-0 flex-1 truncate font-medium">{section.name}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-subtle-foreground">{count.toLocaleString()}</span>
              </ScriptLink>
            }>
            {items}
          </NavigationBranch>;
        })}
    </NavigationPane>
  );
}

/** A link that changes what the center shows, keeping the list's own search and its automatic marks. */
function ScriptLink({ projectId, scope, clearPeopleFilters, className, children, ...props }: { projectId: string; scope: ScriptScope; clearPeopleFilters?: boolean; className?: string; children: ReactNode; title?: string; 'aria-current'?: 'page' }) {
  return (
    <Link
      to="/p/$projectId/script"
      params={{ projectId }}
      search={(previous) => ({
        // Navigation changes only the source scope; user filters remain in the URL and Back/Forward.
        gq: previous.gq,
        marks: previous.marks as LineMark[] | undefined,
        q: previous.q,
        statuses: previous.statuses,
        hideStatuses: previous.hideStatuses,
        tags: previous.tags,
        hideTags: previous.hideTags,
        hideMarks: previous.hideMarks as LineMark[] | undefined,
        speakers: clearPeopleFilters ? undefined : previous.speakers,
        hideSpeakers: clearPeopleFilters ? undefined : previous.hideSpeakers,
        listener: clearPeopleFilters ? undefined : previous.listener,
        mode: previous.mode === 'find' ? ('find' as const) : undefined,
        group: undefined,
        review: undefined,
        kind: undefined,
        section: undefined,
        ...scope,
      })}
      className={className}
      {...props}
    >
      {children}
    </Link>
  );
}

function ScopeLink({ projectId, scope, active, icon, label, count, highlight, clearPeopleFilters }: { projectId: string; scope: ScriptScope; active: boolean; icon: ReactNode; label: string; count: number; highlight?: boolean; clearPeopleFilters?: boolean }) {
  return (
    <NavigationItem asChild active={active}>
      <ScriptLink projectId={projectId} scope={scope} clearPeopleFilters={clearPeopleFilters} aria-current={active ? 'page' : undefined}>
        <span className="[&_svg]:size-3.5 [&_svg]:text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cn('ml-auto text-xs tabular-nums font-mono', highlight ? 'font-medium text-foreground' : 'text-subtle-foreground')}>{count.toLocaleString()}</span>
      </ScriptLink>
    </NavigationItem>
  );
}

function GroupItem({ projectId, group, progress, statuses, active, indent, marks }: { projectId: string; group: GroupRow; progress: { translated: number; final: number }; statuses?: StatusLike[]; active: boolean; indent: boolean; marks?: Map<string, number> }) {
  const complete = group.total > 0 && progress.final === group.total;
  const marked = marks?.get(group.id) ?? 0;
  return (
    <ScriptLink
      projectId={projectId}
      scope={{ group: group.id }}
      title={group.title}
      aria-current={active ? 'page' : undefined}
      className={commonNavigationItem(active, cn(
        'h-auto min-h-7 flex-col items-stretch gap-1 py-1 px-2',
        !active && 'text-foreground/90',
        complete && !active && 'text-subtle-foreground'
      ))}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate">{group.title}</span>
      {marks ? (
        marked ? <span className="shrink-0 rounded-sm bg-warning/15 px-1.5 py-0.5 text-xs font-mono text-warning tabular-nums">{marked}</span> : null
      ) : complete ? (
        <Check className="size-3 shrink-0 text-success" aria-label="완료" />
      ) : (
        <span className="shrink-0 text-xs font-mono text-subtle-foreground tabular-nums" title={`번역함 ${progress.translated}줄 · 확정 ${progress.final}줄 / 전체 ${group.total}줄`} aria-label={`번역함 ${progress.translated} / ${group.total}`}>
          {progress.translated}/{group.total}
        </span>
      )}
      </span>
      {!marks && statuses?.length ? <StatusBar statuses={statuses} counts={group.statuses} className="h-1 w-full" /> : null}
    </ScriptLink>
  );
}
