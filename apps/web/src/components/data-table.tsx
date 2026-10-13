import { useEffect, useRef, type ReactNode } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowData } from '@tanstack/react-table';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Fixed width in px. Columns without one share the rest of the row. */
    width?: number;
    /** Numbers and counts sit at the right edge. */
    align?: 'end';
    /** Cell text may wrap to several lines (source and translation); otherwise it is cut with "…". */
    wrap?: boolean;
    /** Extra classes for the cells of this column (e.g. muted text). */
    className?: string;
  }
}

export type { ColumnDef };

/**
 * Every list in the app. The header stays put while the body scrolls; a row opens its detail in
 * the right-hand pane; checkboxes pick rows for the bulk bar at the bottom. While the first load
 * is pending it shows skeleton rows, never an empty table, and it never scrolls sideways:
 * columns are either a fixed width or share what is left.
 */
export function DataTable<T>({
  columns,
  rows,
  rowId,
  loading,
  empty,
  selected,
  onRowClick,
  picked,
  onPick,
  bulk,
  rowClassName,
  footer,
  className,
}: {
  columns: ColumnDef<T, unknown>[];
  rows: T[] | undefined;
  rowId: (row: T) => string;
  /** True until the first data arrives; `rows === undefined` counts as loading too. */
  loading?: boolean;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  /** Id of the row open in the detail pane. */
  selected?: string;
  onRowClick?: (row: T) => void;
  /** Picked rows (checkboxes). Giving `onPick` turns the checkbox column on. */
  picked?: Set<string>;
  onPick?: (ids: string[], on: boolean) => void;
  /** Actions for the picked rows, shown in a bar under the table. */
  bulk?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  /** Under the table, above the bulk bar (paging). */
  footer?: ReactNode;
  className?: string;
}) {
  const table = useReactTable({ data: rows ?? [], columns, getRowId: rowId, getCoreRowModel: getCoreRowModel() });
  const selectedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [selected, rows]);

  const ids = rows?.map(rowId) ?? [];
  const pickedCount = picked ? ids.filter((id) => picked.has(id)).length : 0;
  const pickable = Boolean(onPick && picked);
  const span = columns.length + (pickable ? 1 : 0);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            {pickable && <col className="w-10" />}
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={column.columnDef.meta?.width ? { width: column.columnDef.meta.width } : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {pickable && (
                  <th className="h-9 border-b pl-4 text-left align-middle">
                    <Checkbox
                      aria-label="모두 선택"
                      checked={ids.length > 0 && pickedCount === ids.length ? true : pickedCount ? 'indeterminate' : false}
                      onCheckedChange={(checked) => onPick!(ids, Boolean(checked))}
                    />
                  </th>
                )}
                {group.headers.map((header, index) => (
                  <th
                    key={header.id}
                    className={cn(
                      'h-9 border-b px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
                      index === 0 && !pickable && 'pl-4',
                      header.column.columnDef.meta?.align === 'end' && 'text-right',
                    )}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading || !rows
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={span} className="border-b px-4 py-2.5">
                      <Skeleton className="h-4" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
                    </td>
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => {
                  const isSelected = row.id === selected;
                  return (
                    <tr
                      key={row.id}
                      ref={isSelected ? selectedRow : undefined}
                      data-state={isSelected ? 'selected' : undefined}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      className={cn(
                        'group/row transition-colors',
                        onRowClick && 'cursor-pointer hover:bg-muted/50',
                        isSelected && 'bg-muted hover:bg-muted',
                        rowClassName?.(row.original),
                      )}
                    >
                      {pickable && (
                        <td className={cn('border-b pl-4 align-top', isSelected && 'shadow-[inset_2px_0_0_var(--primary)]')} onClick={(event) => event.stopPropagation()}>
                          <Checkbox className="mt-2.5" aria-label="선택" checked={picked!.has(row.id)} onCheckedChange={(checked) => onPick!([row.id], Boolean(checked))} />
                        </td>
                      )}
                      {row.getVisibleCells().map((cell, index) => {
                        const meta = cell.column.columnDef.meta;
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              'border-b px-3 py-2 align-top',
                              index === 0 && !pickable && 'pl-4',
                              index === 0 && !pickable && isSelected && 'shadow-[inset_2px_0_0_var(--primary)]',
                              meta?.wrap ? 'break-words whitespace-pre-wrap' : 'truncate',
                              meta?.align === 'end' && 'text-right tabular-nums',
                              meta?.className,
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && rows && rows.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">{empty ?? '항목이 없습니다.'}</div>}
      </div>
      {footer}
      {picked && picked.size > 0 && bulk && (
        <BulkBar count={picked.size} onClear={() => onPick?.([...picked], false)}>
          {bulk}
        </BulkBar>
      )}
    </div>
  );
}

/** The bar for acting on picked rows: count, the actions, and a way out. */
export function BulkBar({ count, onClear, all, children }: {
  count: number;
  onClear: () => void;
  /** A select-all box for what the list shows (checked, partly, or not); it picks or drops them all. */
  all?: { checked: boolean | 'indeterminate'; onChange: (on: boolean) => void };
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-2 text-sm">
      {all && <Checkbox aria-label="이 페이지 모두 선택" checked={all.checked} onCheckedChange={(on) => all.onChange(on === true)} />}
      <span className="font-medium tabular-nums">{count.toLocaleString()}개 선택</span>
      {children}
      <Button variant="ghost" className="ml-auto" onClick={onClear}>
        <X /> 선택 해제
      </Button>
    </div>
  );
}
