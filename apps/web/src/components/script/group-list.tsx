import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusBar } from '@/components/status';
import { Checkbox } from '@/components/ui/checkbox';
import { GROUP_KIND } from '@/lib/labels';
import { cn } from '@/lib/utils';

type Kind = keyof typeof GROUP_KIND;
const KIND_ORDER: Kind[] = ['scene', 'ui', 'document'];

export interface GroupRow {
  id: string;
  kind: Kind;
  title: string;
  section: string | null;
  sort: number;
  total: number;
  statuses: Record<string, number>;
}

interface Section {
  key: string;
  kind: Kind;
  name: string | null;
  groups: GroupRow[];
}

/** Open sections are a per-tab convenience, like the graph viewport: sessionStorage, not history. */
const storageKey = (projectId: string) => `tw.script.sections.${projectId}`;
const readOpen = (projectId: string): string[] | null => {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(projectId)) ?? 'null');
  } catch {
    return null;
  }
};

/**
 * The script's groups, filed by kind (scenes first) and by the section the import file gave them
 * (a chapter, a document's source). Sections fold; the one holding the open group starts open.
 */
export function GroupList({ projectId, groups, statuses, current, picked, onPick, onOpen, expandAll }: {
  projectId: string;
  groups: GroupRow[];
  statuses: { id: string; name: string; color: string }[];
  current?: string;
  picked: Set<string>;
  onPick: (ids: string[], on: boolean) => void;
  onOpen: (id: string) => void;
  /** While searching every section is shown open. */
  expandAll: boolean;
}) {
  const sections = useMemo(() => {
    const ordered = [...groups].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.sort - b.sort);
    const result = new Map<string, Section>();
    for (const group of ordered) {
      const key = `${group.kind}\u0000${group.section ?? ''}`;
      const section = result.get(key) ?? { key, kind: group.kind, name: group.section, groups: [] };
      section.groups.push(group);
      result.set(key, section);
    }
    return [...result.values()];
  }, [groups]);

  const [open, setOpenState] = useState<Set<string>>(() => {
    const saved = readOpen(projectId);
    if (saved) return new Set(saved);
    const holding = sections.find((section) => section.groups.some((group) => group.id === current));
    return new Set(holding ? [holding.key] : []);
  });
  const setOpen = (key: string, on: boolean) =>
    setOpenState((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      try {
        sessionStorage.setItem(storageKey(projectId), JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
      return next;
    });

  const kinds = new Set(sections.map((section) => section.kind));
  let lastKind: Kind | null = null;

  return (
    <ul className="p-1.5 text-[13px]">
      {sections.map((section) => {
        const showKind = kinds.size > 1 && section.kind !== lastKind;
        lastKind = section.kind;
        // A section holding a single group is just that group: no folder around it.
        const folded = section.name !== null && section.groups.length > 1;
        const isOpen = !folded || expandAll || open.has(section.key);
        const ids = section.groups.map((group) => group.id);
        const pickedCount = ids.filter((id) => picked.has(id)).length;
        const lines = section.groups.reduce((sum, group) => sum + group.total, 0);
        const counts: Record<string, number> = {};
        for (const group of section.groups) for (const [id, n] of Object.entries(group.statuses)) counts[id] = (counts[id] ?? 0) + n;
        return (
          <li key={section.key}>
            {showKind && (
              <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">
                {GROUP_KIND[section.kind]} {sections.filter((other) => other.kind === section.kind).reduce((sum, other) => sum + other.groups.length, 0).toLocaleString()}
              </p>
            )}
            {folded && (
              <div className="flex h-7 items-center gap-2 rounded-md px-2 hover:bg-muted">
                <Checkbox
                  className="size-3.5"
                  aria-label={`${section.name} 전체 선택`}
                  checked={pickedCount === ids.length ? true : pickedCount ? 'indeterminate' : false}
                  onCheckedChange={(checked) => onPick(ids, Boolean(checked))}
                />
                <button className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium" onClick={() => setOpen(section.key, !isOpen)} aria-expanded={isOpen}>
                  <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  <span className="truncate" title={section.name ?? undefined}>
                    {section.name}
                  </span>
                  <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{section.groups.length}</span>
                </button>
                <StatusBar statuses={statuses} counts={counts} className="h-1 w-8 shrink-0" />
                <span className="sr-only">대사 {lines}개</span>
              </div>
            )}
            {isOpen && (
              <ul className={cn(folded && 'ml-3.5 border-l pl-1.5')}>
                {section.groups.map((group) => (
                  <li key={group.id} className={cn('flex h-7 items-center gap-2 rounded-md px-2 hover:bg-muted', group.id === current && 'bg-muted font-medium')}>
                    <Checkbox className="size-3.5" aria-label={`${group.title} 선택`} checked={picked.has(group.id)} onCheckedChange={(checked) => onPick([group.id], Boolean(checked))} />
                    <button onClick={() => onOpen(group.id)} className="min-w-0 flex-1 truncate text-left" title={group.title}>
                      {group.title}
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{group.total}</span>
                    <StatusBar statuses={statuses} counts={group.statuses} className="h-1 w-8 shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
