import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusBar } from '@/components/status';
import { Checkbox } from '@/components/ui/checkbox';
import { HeaderFilter } from '@/components/header-filter';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

/** Consecutive groups of the same section, in script order. Kind (scene / document / UI) is a column, not a split. */
export function sectionsOf(groups: GroupRow[]) {
  const sections: { key: string; name: string | null; groups: GroupRow[] }[] = [];
  for (const group of [...groups].sort((a, b) => a.sort - b.sort)) {
    const last = sections.at(-1);
    if (last && last.name === group.section) last.groups.push(group);
    else sections.push({ key: `${sections.length}:${group.section ?? ''}`, name: group.section, groups: [group] });
  }
  return sections;
}

/**
 * Every group of the script in one full-width table, filed under the sections the import gave
 * them (chapters, a document's source). A row opens the group's lines; checkboxes pick groups to run.
 */
export function GroupTable({ projectId, groups, statuses, picked, onPick, onOpen, expandAll, kind, onKind }: {
  projectId: string;
  groups: GroupRow[];
  statuses: { id: string; name: string; color: string }[];
  picked: Set<string>;
  onPick: (ids: string[], on: boolean) => void;
  onOpen: (id: string) => void;
  /** While searching every section is shown open. */
  expandAll: boolean;
  kind?: GroupRow['kind'];
  onKind: (kind: GroupRow['kind'] | undefined) => void;
}) {
  const sections = useMemo(() => sectionsOf(groups), [groups]);
  const [folded, setFoldedState] = useState<Set<string>>(() => new Set(readFolded(projectId)));
  const toggle = (name: string) =>
    setFoldedState((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        sessionStorage.setItem(storageKey(projectId), JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
      return next;
    });
  const allIds = groups.map((group) => group.id);
  const pickedAll = allIds.length > 0 && allIds.every((id) => picked.has(id));

  return (
    <Table className="table-fixed">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead className="w-10 pl-6">
            <Checkbox aria-label="모든 묶음 선택" checked={pickedAll ? true : picked.size ? 'indeterminate' : false} onCheckedChange={(checked) => onPick(allIds, Boolean(checked))} />
          </TableHead>
          <TableHead>제목</TableHead>
          <TableHead className="w-20">
            <HeaderFilter label="종류" value={kind} onChange={(value) => onKind(value as GroupRow['kind'] | undefined)} options={(Object.keys(GROUP_KIND) as GroupRow['kind'][]).map((value) => ({ value, label: GROUP_KIND[value] }))} />
          </TableHead>
          <TableHead className="w-20 text-right">대사</TableHead>
          <TableHead className="w-48">진행</TableHead>
          <TableHead className="w-24 text-right">청자 미상</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((section) => {
          const ids = section.groups.map((group) => group.id);
          const pickedCount = ids.filter((id) => picked.has(id)).length;
          const open = expandAll || !section.name || !folded.has(section.name);
          const counts: Record<string, number> = {};
          for (const group of section.groups) for (const [id, n] of Object.entries(group.statuses)) counts[id] = (counts[id] ?? 0) + n;
          const lines = section.groups.reduce((sum, group) => sum + group.total, 0);
          const unknown = section.groups.reduce((sum, group) => sum + group.unknownListeners, 0);
          return (
            <Fragment key={section.key}>
              {section.name && (
                <TableRow className="bg-muted/40 hover:bg-muted/60">
                  <TableCell className="pl-6">
                    <Checkbox aria-label={`${section.name} 전체 선택`} checked={pickedCount === ids.length ? true : pickedCount ? 'indeterminate' : false} onCheckedChange={(checked) => onPick(ids, Boolean(checked))} />
                  </TableCell>
                  <TableCell colSpan={2}>
                    <button className="flex w-full min-w-0 items-center gap-1 text-left font-medium" onClick={() => section.name && toggle(section.name)} aria-expanded={open}>
                      <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                      <span className="truncate">{section.name}</span>
                      <span className="ml-1 shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{section.groups.length}개</span>
                    </button>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{lines.toLocaleString()}</TableCell>
                  <TableCell>
                    <StatusBar statuses={statuses} counts={counts} className="h-1.5" />
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', unknown ? 'text-warning' : 'text-muted-foreground')}>{unknown || '—'}</TableCell>
                </TableRow>
              )}
              {open &&
                section.groups.map((group) => (
                  <TableRow key={group.id} className="cursor-pointer" onClick={() => onOpen(group.id)}>
                    <TableCell className="pl-6" onClick={(event) => event.stopPropagation()}>
                      <Checkbox aria-label={`${group.title} 선택`} checked={picked.has(group.id)} onCheckedChange={(checked) => onPick([group.id], Boolean(checked))} />
                    </TableCell>
                    <TableCell className={cn('truncate', section.name && 'pl-7')} title={`${group.title} · ${group.key}`}>
                      {group.title}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{GROUP_KIND[group.kind]}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.total.toLocaleString()}</TableCell>
                    <TableCell>
                      <StatusBar statuses={statuses} counts={group.statuses} className="h-1.5" />
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', group.unknownListeners ? 'text-warning' : 'text-muted-foreground')}>{group.unknownListeners || '—'}</TableCell>
                  </TableRow>
                ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
