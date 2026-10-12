import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, ChevronRight, Inbox, Rows3 } from 'lucide-react';
import { SearchInput } from '@/components/toolbar';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GROUP_KIND } from '@/lib/labels';
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

/** Folded sections are a per-tab convenience, like the graph viewport: sessionStorage, not history. */
const storageKey = (projectId: string) => `tw.script.folded.${projectId}`;
const readFolded = (projectId: string): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(projectId)) ?? '[]');
  } catch {
    return [];
  }
};

/** Consecutive groups of the same section, in script order. */
export function sectionsOf(groups: GroupRow[]) {
  const sections: { key: string; name: string | null; groups: GroupRow[] }[] = [];
  for (const group of [...groups].sort((a, b) => a.sort - b.sort)) {
    const last = sections.at(-1);
    if (last && last.name === group.section) last.groups.push(group);
    else sections.push({ key: `${sections.length}:${group.section ?? ''}`, name: group.section, groups: [group] });
  }
  return sections;
}

export type ScriptScope = { group?: string; review?: true };

/**
 * The script's scenes down the left of the translation screen, with "모든 대사" and "검토함" on top.
 * Each scene shows only how many of its lines are done (in a final status), or a check when all are.
 */
export function GroupList({ projectId, groups, finalIds, scope, lineTotal, reviewCount, gq, onFilter, marks }: {
  projectId: string;
  groups: GroupRow[] | undefined;
  /** Statuses that count as done. */
  finalIds: Set<string>;
  scope: ScriptScope;
  lineTotal: number;
  reviewCount: number;
  gq?: string;
  onFilter: (gq: string | undefined) => void;
  /** While a filter is walked (찾아가기): how many of its lines each scene holds; scenes keep the filter. */
  marks?: Map<string, number>;
}) {
  const sections = useMemo(() => sectionsOf(groups ?? []), [groups]);
  const [folded, setFolded] = useState<Set<string>>(() => new Set(readFolded(projectId)));
  const toggle = (name: string, open: boolean) =>
    setFolded((previous) => {
      const next = new Set(previous);
      if (open) next.delete(name);
      else next.add(name);
      try {
        sessionStorage.setItem(storageKey(projectId), JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
      return next;
    });
  const doneOf = (group: GroupRow) => Object.entries(group.statuses).reduce((sum, [id, n]) => sum + (finalIds.has(id) ? n : 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar/40">
      <div className="space-y-0.5 border-b p-2">
        <ScopeLink projectId={projectId} scope={{}} active={!scope.group && !scope.review} icon={<Rows3 />} label="모든 대사" count={lineTotal} />
        <ScopeLink projectId={projectId} scope={{ review: true }} active={Boolean(scope.review)} icon={<Inbox />} label="검토함" count={reviewCount} highlight={reviewCount > 0} />
      </div>
      <div className="border-b p-2">
        <SearchInput value={gq} onChange={onFilter} placeholder="장면 찾기" className="w-full" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {!groups && <p className="px-3 py-2 text-xs text-muted-foreground">불러오는 중…</p>}
        {groups?.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">맞는 장면이 없습니다.</p>}
        {sections.map((section) => {
          const open = Boolean(gq) || !section.name || !folded.has(section.name) || section.groups.some((group) => group.id === scope.group);
          const items = section.groups.map((group) => <GroupItem key={group.id} projectId={projectId} group={group} done={doneOf(group)} active={group.id === scope.group} indent={Boolean(section.name)} marks={marks} />);
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

/** A link that changes what the center shows, keeping the list's own search and "남은 줄만". */
function ScriptLink({ projectId, scope, keep, className, children, ...props }: { projectId: string; scope: ScriptScope; keep?: boolean; className?: string; children: ReactNode; title?: string; 'aria-current'?: 'page' }) {
  return (
    <Link
      to="/p/$projectId/script"
      params={{ projectId }}
      // keep: a filter being walked stays on (찾아가기); the scene opens at its first match.
      search={(previous) =>
        keep
          ? { gq: previous.gq, remaining: previous.remaining, q: previous.q, status: previous.status, tag: previous.tag, speaker: previous.speaker, listener: previous.listener, view: previous.view === 'find' ? ('find' as const) : undefined, ...scope }
          : { gq: previous.gq, remaining: previous.remaining, ...scope }
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
    <ScriptLink projectId={projectId} scope={scope} aria-current={active ? 'page' : undefined} className={cn('flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground', active && 'bg-muted font-medium')}>
      {icon}
      {label}
      <span className={cn('ml-auto text-xs tabular-nums', highlight ? 'font-medium text-foreground' : 'text-muted-foreground')}>{count.toLocaleString()}</span>
    </ScriptLink>
  );
}

function GroupItem({ projectId, group, done, active, indent, marks }: { projectId: string; group: GroupRow; done: number; active: boolean; indent: boolean; marks?: Map<string, number> }) {
  const complete = group.total > 0 && done === group.total;
  const marked = marks?.get(group.id) ?? 0;
  return (
    <ScriptLink
      projectId={projectId}
      scope={{ group: group.id }}
      keep={Boolean(marks)}
      title={group.title}
      aria-current={active ? 'page' : undefined}
      className={cn('flex h-8 items-center gap-2 rounded-md pr-2 text-sm', indent ? 'pl-7' : 'pl-2', active ? 'bg-muted font-medium' : 'hover:bg-muted/60', complete && !active && 'text-muted-foreground')}
    >
      <span className="min-w-0 flex-1 truncate">{group.title}</span>
      {marks ? (
        marked ? <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-xs text-warning tabular-nums">{marked}</span> : null
      ) : complete ? (
        <Check className="size-3.5 shrink-0 text-success" aria-label="완료" />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{done}/{group.total}</span>
      )}
    </ScriptLink>
  );
}
