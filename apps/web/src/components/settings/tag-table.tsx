/** The tags of a settings target as a table, and a project's automatic tags beside them. */
import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARK_IDS, AUTO_MARKS, markColor, markName, TAG_SCOPE_LABELS, TAG_SCOPES, type AutoMark, type MarkStyles, type TagScope } from '@loca/shared';
import { Button, ContextMenuItem, ContextMenuSeparator, DataTable, EmptyState, TagChip, type ColumnDef } from '@loca/ui';
import { HeaderFilter } from '@/components/header-filter';
import { MarkPane } from '@/components/settings/mark-pane';
import { scopeLabel } from '@/components/settings/status-types';
import type { TagRow } from '@/components/settings/taxonomy-source';
import { MarkChip } from '@/components/status';
import { saveProject, useProject } from '@/lib/project';
import { targetScope, type SettingsTarget } from '@/lib/settings-target';
import { usePicked } from '@/lib/use-picked';

/**
 * One table for a project's tags and the home's defaults: the same columns, the 붙는 곳 filter, order by dragging,
 * picks and menu. A project's rows also say how many lines and items carry each.
 */
export function TagTable({ target, rows, place, onPlace, selected, onToggle, onOpen, onReorder, onDelete }: {
  target: SettingsTarget;
  /** Every tag; the table shows those that can be put on `place`. */
  rows: TagRow[] | undefined;
  /** The 붙는 곳 filter (the `on` URL param). */
  place: TagScope | undefined;
  onPlace: (place: TagScope | undefined) => void;
  selected: string | undefined;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onReorder: (ids: string[]) => void;
  /** Asks to delete these (the page confirms). */
  onDelete: (tags: TagRow[]) => void;
}) {
  const counted = target.kind === 'project';
  const picks = usePicked(`tags.${targetScope(target)}`);
  const shown = useMemo(() => (rows && place ? rows.filter((tag) => tag.scope.includes(place)) : rows), [rows, place]);
  const picked = useMemo(() => (shown ?? []).filter((tag) => picks.picked.has(tag.id)), [shown, picks.picked]);
  const pickedIds = useMemo(() => new Set(picked.map((tag) => tag.id)), [picked]);
  const columns: ColumnDef<TagRow, unknown>[] = [
    { id: 'name', header: '이름', meta: { width: 220, hideable: false }, cell: ({ row }) => <TagChip tag={row.original} /> },
    {
      id: 'on',
      header: () => <HeaderFilter label="붙는 곳" value={place} options={TAG_SCOPES.map((value) => ({ value, label: TAG_SCOPE_LABELS[value] }))} onChange={(value) => onPlace(value as TagScope | undefined)} />,
      meta: { width: 140, label: '붙는 곳', tone: 'muted' },
      cell: ({ row }) => scopeLabel(row.original.scope),
    },
    { id: 'description', header: '설명', meta: { tone: 'muted' }, cell: ({ row }) => row.original.description ?? '' },
    ...(counted ? [{ id: 'units', header: '붙은 수', meta: { width: 88, align: 'end' }, cell: ({ row }) => ((row.original.units ?? 0) + (row.original.items ?? 0)).toLocaleString() } satisfies ColumnDef<TagRow, unknown>] : []),
  ];
  return (
    <DataTable
      compact
      id={counted ? 'tags' : 'default-tags'}
      columns={columns}
      rows={shown}
      rowId={(row) => row.id}
      selected={selected}
      empty={<EmptyState noun="태그" filtered={Boolean(place)} />}
      onRowClick={(row) => onToggle(row.id)}
      // Only rows that are still there count as picked: a deleted row's pick goes with it.
      picked={pickedIds}
      onPick={picks.pick}
      bulk={
        <Button variant="outline" tone="danger" disabled={!picked.length} onClick={() => onDelete(picked)}>
          <Trash2 /> 삭제
        </Button>
      }
      // Only in the whole list (a filtered list would hide where they land).
      onReorder={place ? undefined : onReorder}
      rowLabel={(row) => row.name}
      rowContextMenu={(row) => (
        <>
          <ContextMenuItem onClick={() => onOpen(row.id)}>태그 편집</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => onDelete(picks.picked.has(row.id) && picked.length > 1 ? picked : [row])}>
            삭제
          </ContextMenuItem>
        </>
      )}
    />
  );
}

/** The automatic tags that can sit on `place` (all of them without one). */
export const autoTagsOn = (place: TagScope | undefined): AutoMark[] => (place ? AUTO_MARK_IDS.filter((id) => (AUTO_MARKS[id].on as readonly string[]).includes(place)) : [...AUTO_MARK_IDS]);

/** A project's automatic tags: what the app reads off a line, a term or an item. Shown to be understood; only the name and colour are the project's. */
export function AutoTagTable({ place, selected, onToggle, onOpen }: { place: TagScope | undefined; selected: AutoMark | undefined; onToggle: (mark: AutoMark) => void; onOpen: (mark: AutoMark) => void }) {
  const columns: ColumnDef<{ id: AutoMark }, unknown>[] = [
    { id: 'name', header: '이름', meta: { width: 220 }, cell: ({ row }) => <MarkChip mark={row.original.id} /> },
    { id: 'on', header: '붙는 곳', meta: { width: 140, tone: 'muted' }, cell: ({ row }) => scopeLabel(AUTO_MARKS[row.original.id].on) },
    { id: 'description', header: '설명', meta: { tone: 'muted' }, cell: ({ row }) => AUTO_MARKS[row.original.id].description },
  ];
  return <DataTable compact id="auto-tags" columns={columns} rows={autoTagsOn(place).map((id) => ({ id }))} rowId={(row) => row.id} selected={selected} onRowClick={(row) => onToggle(row.id)} rowContextMenu={(row) => <ContextMenuItem onClick={() => onOpen(row.id)}>태그 편집</ContextMenuItem>} />;
}

/** The pane of one automatic tag of a project: its name and colour here; what equals the app's default is not stored. */
export function ProjectMarkPane({ projectId, mark, onClose }: { projectId: string; mark: AutoMark; onClose: () => void }) {
  const project = useProject(projectId);
  const markStyles = ((project.data as { markStyles?: MarkStyles } | undefined)?.markStyles ?? {}) as MarkStyles;
  const save = useMutation({
    mutationFn: (style: { name: string; color: string }) => {
      const info = AUTO_MARKS[mark];
      const own = { ...(style.name !== info.name && { name: style.name }), ...(style.color !== info.color && { color: style.color }) };
      const next: MarkStyles = { ...markStyles };
      if (Object.keys(own).length) next[mark] = own;
      else delete next[mark];
      return saveProject(projectId, { markStyles: next });
    },
    onSuccess: () => toast.success('저장했습니다.'),
    onError: (error) => toast.error(error.message),
  });
  return <MarkPane key={mark} mark={mark} style={{ name: markName(mark, markStyles), color: markColor(mark, markStyles) }} pending={save.isPending} onClose={onClose} onSave={(style) => save.mutate(style)} />;
}
