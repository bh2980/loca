import { useRevealDock } from "../layout/right-dock"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../primitives/context-menu"
import { forwardRef, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type Ref } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type Row,
  type RowData,
  type VisibilityState,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { SelectionBar } from "./picked-bar"
import { EmptyState } from "./empty-state"
import { ColumnMenu } from "./column-menu"
import { Checkbox } from "../primitives/checkbox"
import { Skeleton } from "../primitives/skeleton"
import { cn } from "../lib/utils"
import { Button } from "../primitives/button"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Starting width in px. Columns without one share the rest of the row. */
    width?: number
    /** False keeps the column at its width (no drag handle). */
    resizable?: boolean
    /** Numbers and counts sit at the right edge. */
    align?: "end"
    /** Cell text may wrap to several lines (source and translation); otherwise it is cut with "…". */
    wrap?: boolean
    /** Extra classes for the cells of this column (e.g. muted text). */
    className?: string
    /** Name in the 열 고르기 menu when the header is not a plain string (filter headers). */
    label?: string
    /** False keeps the column always shown (the main identifying column). */
    hideable?: false
  }
}

export type { ColumnDef }

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const mergeRefs = <E,>(...refs: (Ref<E> | undefined)[]) => (node: E | null) => {
  for (const ref of refs) {
    if (typeof ref === "function") ref(node)
    else if (ref) (ref as { current: E | null }).current = node
  }
}

/** A row that can be dragged by its grip (the first cell); a context-menu trigger may wrap it. */
const SortableRow = forwardRef<
  HTMLTableRowElement,
  Omit<ComponentProps<"tr">, "children"> & { sortId: string; locked: boolean; label: string; children: (grip: ReactNode) => ReactNode }
>(function SortableRow({ sortId, locked, label, children, style, ...rest }, ref) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: sortId, disabled: locked })
  const grip = locked ? null : (
    <Button
      ref={setActivatorNodeRef}
      variant="ghost"
      size="icon-xs"
      className="h-6 w-3.5 cursor-grab touch-none rounded-xs text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-foreground"
      aria-label={`${label} 순서 바꾸기 (스페이스를 누르고 ↑↓)`}
      onClick={(event) => event.stopPropagation()}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </Button>
  )
  return (
    <tr
      ref={mergeRefs(ref, setNodeRef)}
      style={{ ...style, transform: CSS.Transform.toString(transform), transition, position: "relative", zIndex: isDragging ? 1 : undefined }}
      {...rest}
    >
      {children(grip)}
    </tr>
  )
})

const MIN_WIDTH = 48
const FLEX_MIN = 140
const widthsKey = (id: string) => `loca-table-widths:${id}`

function loadWidths(id?: string): ColumnSizingState {
  if (!id || typeof window === "undefined") return {}
  try {
    const raw = JSON.parse(localStorage.getItem(widthsKey(id)) ?? "{}") as unknown
    if (!raw || typeof raw !== "object") return {}
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && entry[1] >= MIN_WIDTH
      )
    )
  } catch {
    return {}
  }
}

const columnsKey = (id: string) => `loca-table-columns:${id}`
type SavedColumns = { order: string[]; hidden: string[] }

function loadColumns(id?: string): SavedColumns {
  const none = { order: [], hidden: [] }
  if (!id || typeof window === "undefined") return none
  try {
    const raw = JSON.parse(localStorage.getItem(columnsKey(id)) ?? "null") as Partial<SavedColumns> | null
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
    return raw && typeof raw === "object"
      ? { order: strings(raw.order), hidden: strings(raw.hidden) }
      : none
  } catch {
    return none
  }
}

function saveColumns(id: string | undefined, saved: SavedColumns | undefined) {
  if (!id || typeof window === "undefined") return
  try {
    if (saved) localStorage.setItem(columnsKey(id), JSON.stringify(saved))
    else localStorage.removeItem(columnsKey(id))
  } catch {
    // Storage unavailable
  }
}

function applyOrder(defaults: string[], saved: string[]): string[] {
  const order = saved.filter((id, index) => defaults.includes(id) && saved.indexOf(id) === index)
  defaults.forEach((id, index) => {
    if (order.includes(id)) return
    const before = index > 0 ? order.indexOf(defaults[index - 1]) : -1
    order.splice(before + 1, 0, id)
  })
  return order
}

function saveWidths(id: string | undefined, widths: ColumnSizingState) {
  if (!id || typeof window === "undefined") return
  try {
    if (Object.keys(widths).length) localStorage.setItem(widthsKey(id), JSON.stringify(widths))
    else localStorage.removeItem(widthsKey(id))
  } catch {
    // Storage unavailable
  }
}

export interface DataTableProps<T> {
  id?: string
  columns: ColumnDef<T, unknown>[]
  rows: T[] | undefined
  rowId: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  selected?: string
  onRowClick?: (row: T) => void
  picked?: ReadonlySet<string>
  onPick?: (ids: string[], on: boolean) => void
  bulk?: ReactNode
  rowClassName?: (row: T) => string | undefined
  footer?: ReactNode
  className?: string
  rowContextMenu?: (row: T) => ReactNode
  /** Which rows have a checkbox (others, e.g. built-in items, cannot be picked). */
  canPick?: (row: T) => boolean
  /** Rows can be dragged into a new order (small tables: no virtual scrolling); gets every row id in the new order. */
  onReorder?: (ids: string[]) => void
  /** Which rows can move; others stay put and cannot be dropped on. */
  reorderable?: (row: T) => boolean
  /** Names a row for its grip's label. */
  rowLabel?: (row: T) => string
}

export function DataTable<T>(props: DataTableProps<T>) {
  return <Table key={props.id} {...props} />
}

function Table<T>({
  id,
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
  rowContextMenu,
  onReorder,
  reorderable,
  rowLabel,
  canPick,
}: DataTableProps<T>) {
  const revealDock = useRevealDock()
  const [sizing, setSizing] = useState<ColumnSizingState>(() => loadWidths(id))
  const [saved, setSaved] = useState<SavedColumns>(() => loadColumns(id))
  const defaultOrder = columns.map((column, index) => column.id ?? `col-${index}`)
  const defaultKey = defaultOrder.join("\n")
  const columnOrder: ColumnOrderState = useMemo(
    () => applyOrder(defaultKey ? defaultKey.split("\n") : [], saved.order),
    [defaultKey, saved.order]
  )
  const columnVisibility: VisibilityState = useMemo(() => {
    const unhideable = new Set(
      columns.filter((column) => column.meta?.hideable === false).map((column) => column.id)
    )
    return Object.fromEntries(
      saved.hidden
        .filter((hidden) => !unhideable.has(hidden))
        .map((hidden) => [hidden, false])
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.hidden, defaultKey])

  const table = useReactTable({
    data: rows ?? [],
    columns,
    getRowId: rowId,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    state: { columnSizing: sizing, columnOrder, columnVisibility },
    onColumnSizingChange: setSizing,
  })

  useEffect(() => saveWidths(id, sizing), [id, sizing])
  useEffect(
    () => saveColumns(id, saved.order.length || saved.hidden.length ? saved : undefined),
    [id, saved]
  )

  const labelOf = (column: ColumnDef<T, unknown>, columnId: string) =>
    column.meta?.label ?? (typeof column.header === "string" ? column.header : columnId)

  const menuItems = columnOrder.map((columnId) => {
    const column = columns.find(
      (candidate, index) => (candidate.id ?? `col-${index}`) === columnId
    )!
    return {
      id: columnId,
      label: labelOf(column, columnId),
      shown: columnVisibility[columnId] !== false,
      hideable: column.meta?.hideable !== false,
    }
  })

  const resetColumns = () => {
    setSaved({ order: [], hidden: [] })
    setSizing({})
  }

  const startResize = (event: React.PointerEvent<HTMLElement>, columnId: string) => {
    const cell = event.currentTarget.parentElement
    if (!cell) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = cell.getBoundingClientRect().width
    // A fixed-layout table wider than its columns hands the spare width to every column in proportion, so
    // moving one edge moved the others. Freeze every column at the width it shows now; the table is then
    // exactly as wide as its columns (see `width` below) and only the dragged one changes.
    // The last column is left out: it takes whatever width is left (fillerId below).
    const shown: ColumnSizingState = {}
    for (const th of cell.parentElement?.querySelectorAll<HTMLElement>("th[data-col]") ?? []) {
      if (th.dataset.col === fillerId) continue
      shown[th.dataset.col!] = Math.max(MIN_WIDTH, Math.round(th.getBoundingClientRect().width))
    }
    table.setColumnSizing((previous) => ({ ...previous, ...shown }))
    handle.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) =>
      table.setColumnSizing((previous) => ({
        ...previous,
        [columnId]: Math.max(MIN_WIDTH, Math.round(startWidth + next.clientX - startX)),
      }))
    const stop = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", stop)
      handle.removeEventListener("pointercancel", stop)
      setResizing(undefined)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", stop)
    handle.addEventListener("pointercancel", stop)
    setResizing(columnId)
  }

  const resetWidth = (columnId: string) =>
    table.setColumnSizing((previous) => {
      const { [columnId]: _dropped, ...rest } = previous
      return rest
    })

  const [resizing, setResizing] = useState<string>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRow = useRef<HTMLTableRowElement>(null)

  const ids = useMemo(() => rows?.map(rowId) ?? [], [rows, rowId])
  const pickableIds = useMemo(() => (canPick ? (rows ?? []).filter(canPick).map(rowId) : ids), [rows, rowId, canPick, ids])
  const pickedInView = useMemo(
    () => (picked ? pickableIds.filter((id) => picked.has(id)).length : 0),
    [picked, pickableIds]
  )
  const pickedCount = pickedInView
  // No checkbox column when no row can be picked (e.g. only built-in items).
  const pickable = Boolean(onPick && picked) && (!canPick || pickableIds.length > 0)
  const bulking = Boolean(bulk && picked && picked.size > 0)
  const visibleColumns = table.getVisibleLeafColumns()
  const fillerId = visibleColumns.at(-1)?.id
  const menuWidth = id ? 32 : 0
  const sortable = Boolean(onReorder)
  // One leading cell holds the checkbox, with the drag grip in its left padding (no column of its own).
  const lead = pickable || (sortable && (!reorderable || (rows ?? []).some(reorderable)))
  const span = visibleColumns.length + (lead ? 1 : 0) + (id ? 1 : 0)

  const tableRows = table.getRowModel().rows
  const virtualize = !sortable && tableRows.length > 80
  const rowVirtualizer = useVirtualizer({
    count: virtualize ? tableRows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 15,
  })

  useEffect(() => {
    if (!selected) return
    if (virtualize) {
      const idx = tableRows.findIndex((r) => r.id === selected)
      if (idx !== -1) {
        rowVirtualizer.scrollToIndex(idx, { align: "auto" })
      }
    } else {
      selectedRow.current?.scrollIntoView({ block: "nearest" })
    }
  }, [selected, virtualize, tableRows, rowVirtualizer])

  // The last column fills the row, so the table is never narrower than its pane (no blank strip on
  // the right after narrowing a column); it has no width of its own and no drag handle, and is at
  // least its starting width (or FLEX_MIN) when the others take the room.
  const widthOf = (column: { id: string; columnDef: ColumnDef<T, unknown> }) =>
    column.id === fillerId ? undefined : (sizing[column.id] ?? column.columnDef.meta?.width)
  const minWidth =
    (pickable ? 36 : sortable ? 20 : 0) +
    menuWidth +
    visibleColumns.reduce((sum, column) => sum + (widthOf(column) ?? (column.id === fillerId ? (column.columnDef.meta?.width ?? FLEX_MIN) : FLEX_MIN)), 0)

  // One ContextMenu for the whole table: its pointer anchor span must not
  // live inside <tbody>, so rows only render a trigger around the <tr>.
  const [rowMenu, setRowMenu] = useState<ReactNode>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !onReorder) return
    const target = rows?.find((row) => rowId(row) === over.id)
    if (target && reorderable && !reorderable(target)) return
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  const renderRow = (row: Row<T>) => {
    const isSelected = row.id === selected
    const menu = rowContextMenu?.(row.original)
    const rowProps = {
      "data-state": isSelected ? "selected" : undefined,
      onContextMenu: menu ? () => setRowMenu(menu) : undefined,
      onClick: onRowClick
        ? () => {
            revealDock?.()
            onRowClick(row.original)
          }
        : undefined,
      className: cn(
        "group/row transition-colors",
        onRowClick && "cursor-pointer hover:bg-accent",
        isSelected && "bg-selection hover:bg-selection",
        rowClassName?.(row.original)
      ),
    }
    const cells = (grip?: ReactNode) => (
      <>
        {lead && (
          <td
            className={cn("relative align-middle py-2.5", pickable && "pl-3.5")}
            onClick={(event) => event.stopPropagation()}
          >
            {grip && <span className="absolute inset-y-0 left-0 flex items-center">{grip}</span>}
            {pickable && (!canPick || canPick(row.original)) && (
              <Checkbox
                aria-label="선택"
                checked={picked!.has(row.id)}
                onCheckedChange={(checked) => onPick!([row.id], Boolean(checked))}
              />
            )}
          </td>
        )}
        {row.getVisibleCells().map((cell, index) => {
          const meta = cell.column.columnDef.meta
          return (
            <td
              key={cell.id}
              className={cn(
                "px-3 py-2.5 align-middle text-sm text-foreground",
                index === 0 && !lead && "pl-4",
                meta?.wrap ? "break-words whitespace-pre-wrap" : "truncate",
                meta?.align === "end" && "text-right tabular-nums",
                meta?.className
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          )
        })}
        {id && <td />}
      </>
    )
    const tr = sortable ? (
      <SortableRow
        key={row.id}
        ref={isSelected ? selectedRow : undefined}
        sortId={row.id}
        locked={reorderable ? !reorderable(row.original) : false}
        label={rowLabel?.(row.original) ?? "행"}
        {...rowProps}
      >
        {(grip) => cells(grip)}
      </SortableRow>
    ) : (
      <tr key={row.id} ref={isSelected ? selectedRow : undefined} {...rowProps}>
        {cells()}
      </tr>
    )
    if (menu) {
      return (
        <ContextMenuTrigger key={row.id} asChild>
          {tr}
        </ContextMenuTrigger>
      )
    }
    return tr
  }

  return (
    <ContextMenu onOpenChange={(open) => !open && setRowMenu(null)}>
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-sm"
          style={{ minWidth, width: `max(${minWidth}px, 100%)` }}
        >
          <colgroup>
            {lead && <col className={pickable ? "w-9" : "w-5"} />}
            {visibleColumns.map((column) => (
              <col
                key={column.id}
                style={widthOf(column) ? { width: widthOf(column) } : undefined}
              />
            ))}
            {id && <col style={{ width: menuWidth }} />}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-chrome backdrop-blur-xs select-none">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {lead && !pickable && <th className="h-8" />}
                {pickable && (
                  <th className="h-8 pl-3.5 text-left align-middle">
                    <Checkbox
                      aria-label="모두 선택"
                      disabled={pickableIds.length === 0}
                      checked={
                        pickableIds.length > 0 && pickedCount === pickableIds.length
                          ? true
                          : pickedCount
                          ? "indeterminate"
                          : false
                      }
                      onCheckedChange={(checked) => onPick!(pickableIds, Boolean(checked))}
                    />
                  </th>
                )}
                {bulking ? (
                  <th
                    colSpan={group.headers.length + (id ? 1 : 0)}
                    className="h-8 px-3 text-left align-middle font-normal"
                  >
                    <SelectionBar
                      count={picked!.size}
                      onClear={() => onPick?.([...picked!], false)}
                    >
                      {bulk}
                    </SelectionBar>
                  </th>
                ) : (
                  group.headers.map((header, index) => (
                    <th
                      key={header.id}
                      data-col={header.column.id}
                      className={cn(
                        "group/th relative h-8  px-3 text-left align-middle text-xs font-normal text-muted-foreground whitespace-nowrap",
                        index === 0 && !lead && "pl-4",
                        header.column.columnDef.meta?.align === "end" && "text-right"
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {!header.isPlaceholder &&
                        header.column.columnDef.meta?.resizable !== false &&
                        header.column.id !== fillerId && (
                          <span
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`${
                              typeof header.column.columnDef.header === "string"
                                ? header.column.columnDef.header
                                : "열"
                            } 너비 조절 (두 번 누르면 처음 너비)`}
                            className="absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize touch-none justify-center select-none"
                            onPointerDown={(event) => startResize(event, header.column.id)}
                            onDoubleClick={() => resetWidth(header.column.id)}
                          >
                            <span
                              className={cn(
                                "h-full w-px bg-transparent transition-colors group-hover/th:bg-border hover:bg-primary",
                                resizing === header.column.id &&
                                  "w-0.5 bg-primary group-hover/th:bg-primary"
                              )}
                            />
                          </span>
                        )}
                    </th>
                  ))
                )}
                {id && !bulking && (
                  <th className="sticky right-0 h-7 bg-chrome px-1 text-right align-middle">
                    <ColumnMenu
                      items={menuItems}
                      onReorder={(order) => setSaved((previous) => ({ ...previous, order }))}
                      onToggle={(columnId, shown) =>
                        setSaved((previous) => ({
                          ...previous,
                          hidden: shown
                            ? previous.hidden.filter((hidden) => hidden !== columnId)
                            : [...new Set([...previous.hidden, columnId])],
                        }))
                      }
                      onReset={resetColumns}
                    />
                  </th>
                )}
              </tr>
            ))}
          </thead>
          <tbody className="bg-background">
            {loading || !rows ? (
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={span} className="px-3.5 py-2">
                    <Skeleton
                      className="h-3.5"
                      style={{ width: `${55 + ((i * 17) % 35)}%` }}
                    />
                  </td>
                </tr>
              ))
            ) : sortable ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={onDragEnd}>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {tableRows.map(renderRow)}
                </SortableContext>
              </DndContext>
            ) : !virtualize ? (
              tableRows.map(renderRow)
            ) : (() => {
              const virtualItems = rowVirtualizer.getVirtualItems()
              if (virtualItems.length === 0) {
                return tableRows.slice(0, 60).map(renderRow)
              }
              const paddingTop = virtualItems[0]?.start ?? 0
              const paddingBottom =
                rowVirtualizer.getTotalSize() -
                (virtualItems[virtualItems.length - 1]?.end ?? 0)
              return (
                <>
                  <tr aria-hidden="true">
                    <td colSpan={span} style={{ height: paddingTop, padding: 0, border: 0 }} />
                  </tr>
                  {virtualItems.map((v) => renderRow(tableRows[v.index]!))}
                  <tr aria-hidden="true">
                    <td colSpan={span} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                  </tr>
                </>
              )
            })()}
          </tbody>
        </table>
        {!loading && rows && rows.length === 0 && (empty ?? <EmptyState noun="항목" />)}
      </div>
      {footer}
    </div>
    {rowMenu && <ContextMenuContent>{rowMenu}</ContextMenuContent>}
    </ContextMenu>
  )
}
