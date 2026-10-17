import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LineMark } from '@tw/shared';
import { Link } from '@tanstack/react-router';
import { AppWindow, Check, ChevronRight, FileText, Inbox, MessageSquareText, Rows3 } from 'lucide-react';
import { SearchInput } from '@/components/toolbar';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@loca/ui';
import { GROUP_KIND, SCRIPT_VIEW } from '@/lib/labels';
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

/** Sections start folded; the opened ones are a per-tab convenience, like the graph viewport: sessionStorage, not history. */
const storageKey = (projectId: string) => `tw.script.opened.${projectId}`;
const readOpened = (projectId: string): string[] => {
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

export type ScriptScope = { group?: string; review?: true; kind?: GroupRow['kind'] };

const VIEW_ICON = { scene: <MessageSquareText />, ui: <AppWindow />, document: <FileText /> };

/**
 * The script's scenes down the left of the translation screen, with "모든 대사" and "검토함" on top.
 * Each scene shows only how many of its lines are done (in a final status), or a check when all are.
 */
/** Scenes from which the list gets its own search box. */
const SEARCH_FROM = 20;

export function GroupList({ projectId, groups, finalIds, initialIds, scope, lineTotal, reviewCount, gq, onFilter, marks, views }: {
  projectId: string;
  groups: GroupRow[] | undefined;
  /** Statuses that count as done. */
  finalIds: Set<string>;
  /** 미번역 and the like: a line past these has been started (translated at least once). */
  initialIds: Set<string>;
  scope: ScriptScope;
  lineTotal: number;
  reviewCount: number;
  gq?: string;
  onFilter: (gq: string | undefined) => void;
  /** While a filter is walked (찾아가기): how many of its lines each scene holds; scenes keep the filter. */
  marks?: Map<string, number>;
  /** The views when the project has more than one kind (대사 · UI · 문서), with their line counts; `groups` are the open view's. */
  views?: { kind: GroupRow['kind']; lines: number }[];
}) {
  const sections = useMemo(() => sectionsOf(groups ?? []), [groups]);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(readOpened(projectId)));
  const toggle = (name: string, open: boolean) =>
    setOpened((previous) => {
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
  // Picking a scene opens its section once; folding it again holds until another scene is picked.
  const pickedSection = sections.find((section) => section.groups.some((group) => group.id === scope.group))?.name;
  useEffect(() => {
    if (pickedSection) toggle(pickedSection, true);
  }, [scope.group, pickedSection]); // eslint-disable-line react-hooks/exhaustive-deps
  // A scene's count is its progress: lines translated (past 미번역), with 확정 named in the hint; the check means all 확정.
  const progressOf = (group: GroupRow) => {
    const lines = Object.entries(group.statuses);
    return { translated: lines.reduce((sum, [id, n]) => sum + (initialIds.has(id) ? 0 : n), 0), final: lines.reduce((sum, [id, n]) => sum + (finalIds.has(id) ? n : 0), 0) };
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar/40">
      <div className="space-y-0.5 border-b p-2">
        {views ? (
          views.map((view) => <ScopeLink key={view.kind} projectId={projectId} scope={{ kind: view.kind }} active={!scope.group && !scope.review && scope.kind === view.kind} icon={VIEW_ICON[view.kind]} label={SCRIPT_VIEW[view.kind]} count={view.lines} />)
        ) : (
          <ScopeLink projectId={projectId} scope={{}} active={!scope.group && !scope.review} icon={<Rows3 />} label="모든 대사" count={lineTotal} />
        )}
        <ScopeLink projectId={projectId} scope={{ review: true }} active={Boolean(scope.review)} icon={<Inbox />} label="검토함" count={reviewCount} highlight={reviewCount > 0} />
      </div>
      {/* A few scenes are read at a glance (⌘K finds scenes too); the box shows once there are many. */}
      {(gq || (groups?.length ?? 0) >= SEARCH_FROM) && (
        <div className="border-b p-2">
          <SearchInput value={gq} onChange={onFilter} placeholder={`${GROUP_KIND[scope.kind ?? 'scene']} 찾기`} className="w-full" />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {!groups && <p className="px-3 py-2 text-xs text-muted-foreground">불러오는 중…</p>}
        {groups?.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">맞는 항목이 없습니다.</p>}
        {sections.map((section) => {
          // A scene search shows its matches wherever they are.
          const open = Boolean(gq) || !section.name || opened.has(section.name);
          const items = section.groups.map((group) => <GroupItem key={group.id} projectId={projectId} group={group} progress={progressOf(group)} active={group.id === scope.group} indent={Boolean(section.name)} marks={marks} />);
          if (!section.name) return <Fragment key={section.key}>{items}</Fragment>;
          return (
            <Collapsible key={section.key} open={open} onOpenChange={(next) => toggle(section.name!, next)}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="row" className="mt-1 text-xs font-medium text-muted-foreground">
                  <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
                  <span className="min-w-0 flex-1 truncate">{section.name}</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>{items}</CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

/** A link that changes what the center shows, keeping the list's own search and its automatic marks. */
function ScriptLink({ projectId, scope, keep, className, children, ...props }: { projectId: string; scope: ScriptScope; keep?: boolean; className?: string; children: ReactNode; title?: string; 'aria-current'?: 'page' }) {
  return (
    <Link
      to="/p/$projectId/script"
      params={{ projectId }}
      // keep: a filter being walked stays on (찾아가기); the scene opens at its first match.
      search={(previous) =>
        keep
          ? { gq: previous.gq, marks: previous.marks as LineMark[] | undefined, q: previous.q, status: previous.status, tags: previous.tags, speaker: previous.speaker, listener: previous.listener, mode: previous.mode === 'find' ? ('find' as const) : undefined, ...scope }
          : { gq: previous.gq, marks: previous.marks as LineMark[] | undefined, ...scope }
      }
      className={className}
      {...props}
    >
      {children}
    </Link>
  );
}

function ScopeLink({ projectId, scope, active, icon, label, count, highlight }: { projectId: string; scope: ScriptScope; active: boolean; icon: ReactNode; label: string; count: number; highlight?: boolean }) {
  return (
    <ScriptLink projectId={projectId} scope={scope} aria-current={active ? 'page' : undefined} className={cn('flex h-7 items-center gap-2 rounded-md px-2 text-xs tracking-tight transition-colors hover:bg-surface-1/80 [&_svg]:size-3.5 [&_svg]:text-muted-foreground', active ? 'bg-surface-1 font-semibold text-foreground shadow-2xs' : 'text-muted-foreground')}>
      {icon}
      <span>{label}</span>
      <span className={cn('ml-auto text-xs tabular-nums font-mono', highlight ? 'font-medium text-foreground' : 'text-muted-foreground/70')}>{count.toLocaleString()}</span>
    </ScriptLink>
  );
}

function GroupItem({ projectId, group, progress, active, indent, marks }: { projectId: string; group: GroupRow; progress: { translated: number; final: number }; active: boolean; indent: boolean; marks?: Map<string, number> }) {
  const complete = group.total > 0 && progress.final === group.total;
  const marked = marks?.get(group.id) ?? 0;
  return (
    <ScriptLink
      projectId={projectId}
      scope={{ group: group.id }}
      keep={Boolean(marks)}
      title={group.title}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md pr-2 text-xs tracking-tight transition-colors',
        indent ? 'pl-6' : 'pl-2',
        active ? 'bg-surface-1 font-semibold text-foreground shadow-2xs' : 'text-foreground/90 hover:bg-surface-1/60',
        complete && !active && 'text-muted-foreground/70'
      )}
    >
      <span className="min-w-0 flex-1 truncate">{group.title}</span>
      {marks ? (
        marked ? <span className="shrink-0 rounded-sm bg-warning/15 px-1.5 py-0.5 text-xs font-mono text-warning tabular-nums">{marked}</span> : null
      ) : complete ? (
        <Check className="size-3 shrink-0 text-success" aria-label="완료" />
      ) : (
        <span className="shrink-0 text-xs font-mono text-muted-foreground/70 tabular-nums" title={`번역함 ${progress.translated}줄 · 확정 ${progress.final}줄 / 전체 ${group.total}줄`} aria-label={`번역함 ${progress.translated} / ${group.total}`}>
          {progress.translated}/{group.total}
        </span>
      )}
    </ScriptLink>
  );
}
