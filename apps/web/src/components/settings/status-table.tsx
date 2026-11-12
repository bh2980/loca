/** The statuses of a settings target as a table, and the confirmation before statuses are deleted. */
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, ContextMenuItem, ContextMenuSeparator, DataTable, EmptyState, Inline, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusIcon, Text, type ColumnDef } from '@loca/ui';
import type { StatusRow } from '@/components/settings/taxonomy-source';
import { STATUS_KIND } from '@/lib/labels';
import { targetScope, type SettingsTarget } from '@/lib/settings-target';
import { usePicked } from '@/lib/use-picked';

/**
 * One table for a project's statuses and the home's defaults: the same columns, order by dragging, picks and menu.
 * A project's rows also say how many lines are in each (`units`).
 */
export function StatusTable({ target, rows, selected, onToggle, onOpen, onReorder, onDelete }: {
  target: SettingsTarget;
  rows: StatusRow[] | undefined;
  /** The status whose pane is open. */
  selected: string | undefined;
  /** A row was clicked. */
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onReorder: (ids: string[]) => void;
  /** Asks to delete these (the page confirms). */
  onDelete: (statuses: StatusRow[]) => void;
}) {
  const counted = target.kind === 'project';
  const picks = usePicked(`statuses.${targetScope(target)}`);
  const picked = useMemo(() => (rows ?? []).filter((status) => picks.picked.has(status.id)), [rows, picks.picked]);
  const pickedIds = useMemo(() => new Set(picked.map((status) => status.id)), [picked]);
  const count = rows?.length ?? 0;
  const move = (status: StatusRow, delta: number) => {
    const ids = (rows ?? []).map((item) => item.id);
    const index = ids.indexOf(status.id);
    [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
    onReorder(ids);
  };
  const columns: ColumnDef<StatusRow, unknown>[] = [
    { id: 'order', header: '순서', meta: { width: 56, tone: 'muted', tabular: true }, cell: ({ row }) => row.index + 1 },
    {
      id: 'name',
      header: '이름',
      meta: { hideable: false },
      cell: ({ row }) => (
        <Inline as="span" inline gap="condensed" weight="medium">
          <StatusIcon small status={row.original} />
          {row.original.name}
        </Inline>
      ),
    },
    { id: 'kind', header: '종류', meta: { width: 112, tone: 'muted' }, cell: ({ row }) => STATUS_KIND[row.original.kind] },
    { id: 'review', header: '검토함', meta: { width: 120 }, cell: ({ row }) => (row.original.inReview ? '표시' : <Text tone="muted">–</Text>) },
    ...(counted ? [{ id: 'units', header: '대사 수', meta: { width: 96, align: 'end' }, cell: ({ row }) => (row.original.units ?? 0).toLocaleString() } satisfies ColumnDef<StatusRow, unknown>] : []),
  ];
  return (
    <DataTable
      compact
      id={counted ? 'statuses' : 'default-statuses'}
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      selected={selected}
      empty={<EmptyState noun="상태" />}
      onRowClick={(row) => onToggle(row.id)}
      // Only rows that are still there count as picked: a deleted row's pick goes with it.
      picked={pickedIds}
      onPick={picks.pick}
      bulk={
        <Button variant="outline" tone="danger" disabled={picked.length >= count} title={picked.length >= count ? '상태를 모두 지울 수는 없습니다' : undefined} onClick={() => onDelete(picked)}>
          <Trash2 /> 삭제
        </Button>
      }
      onReorder={onReorder}
      rowLabel={(row) => row.name}
      rowContextMenu={(row) => {
        const index = rows?.indexOf(row) ?? -1;
        return (
          <>
            <ContextMenuItem onClick={() => onOpen(row.id)}>상태 편집</ContextMenuItem>
            {index > 0 && <ContextMenuItem onClick={() => move(row, -1)}>위로 이동</ContextMenuItem>}
            {index >= 0 && index < count - 1 && <ContextMenuItem onClick={() => move(row, 1)}>아래로 이동</ContextMenuItem>}
            {count >= 2 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => onDelete(picks.picked.has(row.id) && picked.length > 1 ? picked : [row])}>
                  삭제
                </ContextMenuItem>
              </>
            )}
          </>
        );
      }}
    />
  );
}

/** What the confirmation says: a project's statuses hand their lines to another status; the defaults' have none. */
export function statusDeleteWording(statuses: readonly StatusRow[]): { title: string; description: string } {
  const one = statuses.length === 1;
  if (statuses.every((status) => status.units === undefined)) {
    return {
      title: one ? `“${statuses[0]!.name}” 상태를 기본값에서 지울까요?` : `상태 ${statuses.length}개를 기본값에서 지울까요?`,
      description: `새로 만드는 프로젝트가 ${one ? '이 상태를' : '이 상태들을'} 받지 않습니다. 이미 있는 프로젝트는 그대로입니다.`,
    };
  }
  const lines = statuses.reduce((sum, status) => sum + (status.units ?? 0), 0);
  return {
    title: one ? `“${statuses[0]!.name}” 상태를 삭제할까요?` : `상태 ${statuses.length}개를 삭제할까요?`,
    description: `${one ? '이 상태의 ' : `${statuses.map((status) => status.name).join(', ')}의 `}대사 ${lines.toLocaleString()}개를 다른 상태로 옮깁니다. 지운 상태를 쓰는 워크플로 노드는 검증에 실패하므로 수정해야 합니다.`,
  };
}

/**
 * Open while `statuses` is set. A project's statuses need the status their lines move to (`onConfirm` gets it); the
 * dialog stays until the page closes it, so a refused delete keeps the choice.
 */
export function StatusDeleteDialog({ statuses, all, pending, onClose, onConfirm }: { statuses: readonly StatusRow[] | null; all: readonly StatusRow[]; pending: boolean; onClose: () => void; onConfirm: (moveTo?: string) => void }) {
  const wording = statuses?.length ? statusDeleteWording(statuses) : null;
  const moves = Boolean(statuses?.some((status) => status.units !== undefined));
  const others = all.filter((status) => !statuses?.some((gone) => gone.id === status.id));
  // The choice belongs to one asking: another set of statuses starts without it.
  const asked = statuses?.map((status) => status.id).join(',');
  const [choice, setChoice] = useState<{ asked?: string; moveTo: string }>({ moveTo: '' });
  const target = choice.asked === asked && others.some((status) => status.id === choice.moveTo) ? choice.moveTo : '';
  return (
    <ConfirmDialog
      open={!!wording}
      onOpenChange={(next) => !next && onClose()}
      title={wording?.title}
      description={wording?.description}
      keepOpen
      disabled={moves && !target}
      pending={pending}
      onConfirm={() => onConfirm(moves ? target : undefined)}
    >
      {moves && (
        <Select value={target} onValueChange={(moveTo) => setChoice({ asked, moveTo })}>
          <SelectTrigger width="full" aria-label="옮길 상태">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {others.map((status) => (
              <SelectItem key={status.id} value={status.id}>
                <StatusIcon status={status} /> {status.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </ConfirmDialog>
  );
}
