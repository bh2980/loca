import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Inbox, ListFilter, Rows3 } from 'lucide-react';
import { SearchInput } from '@/components/toolbar';
import { StatusBar } from '@/components/status';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
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
 * The script's groups down the left of the translation screen: "모든 대사" and "검토함" on top,
 * then every scene / document / UI group under its section (chapters, Days), with its progress.
 * Checkboxes pick groups to run a workflow on.
 */
export function GroupList({
  projectId,
  groups,
  statuses,
  scope,
  lineTotal,
  reviewCount,
  gq,
  kind,
  onFilter,
  picked,
  onPick,
  bulk,
}: {
  projectId: string;
  groups: GroupRow[] | undefined;
  statuses: { id: string; name: string; color: string }[];
  scope: ScriptScope;
  lineTotal: number;
  reviewCount: number;
  gq?: string;
  kind?: GroupRow['kind'];
  onFilter: (next: { gq?: string; kind?: GroupRow['kind'] }) => void;
  picked: Set<string>;
  onPick: (ids: string[], on: boolean) => void;
  bulk: ReactNode;
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
  const picking = picked.size > 0;

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-sidebar/40">
      <div className="space-y-1 border-b p-2">
        <ScopeLink projectId={projectId} scope={{}} active={!scope.group && !scope.review} icon={<Rows3 />} label="모든 대사" count={lineTotal} />
        <ScopeLink projectId={projectId} scope={{ review: true }} active={Boolean(scope.review)} icon={<Inbox />} label="검토함" count={reviewCount} highlight={reviewCount > 0} />
      </div>
      <div className="flex items-center gap-1 border-b p-2">
        <SearchInput value={gq} onChange={(value) => onFilter({ gq: value, kind })} placeholder="묶음 제목·키" className="w-auto min-w-0 flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="종류 거르기" className={cn(kind && 'text-primary')}>
              <ListFilter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-muted-foreground">종류</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={kind ?? ''} onValueChange={(value) => onFilter({ gq, kind: (value || undefined) as GroupRow['kind'] | undefined })}>
              <DropdownMenuRadioItem value="">전체</DropdownMenuRadioItem>
              {(Object.keys(GROUP_KIND) as GroupRow['kind'][]).map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {GROUP_KIND[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!groups && <p className="px-4 py-3 text-xs text-muted-foreground">불러오는 중…</p>}
        {groups?.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">맞는 묶음이 없습니다.</p>}
        {sections.map((section) => {
          const ids = section.groups.map((group) => group.id);
          const pickedCount = ids.filter((id) => picked.has(id)).length;
          const open = Boolean(gq) || !section.name || !folded.has(section.name) || section.groups.some((group) => group.id === scope.group);
          const items = section.groups.map((group) => (
            <GroupItem key={group.id} group={group} statuses={statuses} active={group.id === scope.group} picking={picking} picked={picked.has(group.id)} onPick={(on) => onPick([group.id], on)} projectId={projectId} />
          ));
          if (!section.name) return <Fragment key={section.key}>{items}</Fragment>;
          return (
            <Collapsible key={section.key} open={open} onOpenChange={(next) => toggle(section.name!, next)}>
              <div className="group/section flex items-center gap-1 px-2 pt-2 pb-1">
                <Checkbox
                  aria-label={`${section.name} 전체 선택`}
                  className={cn('ml-1 opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100', (picking || pickedCount) && 'opacity-100')}
                  checked={pickedCount === ids.length ? true : pickedCount ? 'indeterminate' : false}
                  onCheckedChange={(checked) => onPick(ids, Boolean(checked))}
                />
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="h-7 min-w-0 flex-1 justify-start gap-1 px-1 text-xs font-semibold text-muted-foreground">
                    <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
                    <span className="truncate">{section.name}</span>
                    <span className="ml-auto font-normal tabular-nums">{section.groups.length}</span>
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>{items}</CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
      {picking && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/40 px-3 py-2 text-sm">{bulk}</div>}
    </div>
  );
}

/** A link that changes what the center shows, keeping the list's own filters. */
function ScriptLink({ projectId, scope, className, children, ...props }: { projectId: string; scope: ScriptScope; className?: string; children: ReactNode; title?: string; 'aria-current'?: 'page' }) {
  return (
    <Link to="/p/$projectId/script" params={{ projectId }} search={(previous) => ({ gq: previous.gq, kind: previous.kind, ...scope })} className={className} {...props}>
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

function GroupItem({ projectId, group, statuses, active, picking, picked, onPick }: { projectId: string; group: GroupRow; statuses: { id: string; name: string; color: string }[]; active: boolean; picking: boolean; picked: boolean; onPick: (on: boolean) => void }) {
  return (
    <div className={cn('group/item mx-1 flex items-start gap-1 rounded-md px-1', active ? 'bg-muted' : 'hover:bg-muted/60')}>
      <Checkbox aria-label={`${group.title} 선택`} className={cn('mt-2.5 ml-1 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100', (picking || picked) && 'opacity-100')} checked={picked} onCheckedChange={(checked) => onPick(Boolean(checked))} />
      <ScriptLink projectId={projectId} scope={{ group: group.id }} className="min-w-0 flex-1 py-1.5 pr-1 pl-1" title={`${group.title} · ${group.key}`} aria-current={active ? 'page' : undefined}>
        <div className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm', active && 'font-medium')}>{group.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{group.total.toLocaleString()}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <StatusBar statuses={statuses} counts={group.statuses} className="h-1 flex-1" />
          {group.kind !== 'scene' && <span className="shrink-0 text-xs text-muted-foreground">{GROUP_KIND[group.kind]}</span>}
          {group.unknownListeners > 0 && (
            <span className="shrink-0 text-xs text-warning tabular-nums" title="청자 미상 대사">
              청자 미상 {group.unknownListeners}
            </span>
          )}
        </div>
      </ScriptLink>
    </div>
  );
}
