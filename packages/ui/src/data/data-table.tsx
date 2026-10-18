import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type RowData,
  type VisibilityState,
} from "@tanstack/react-table"
import { SelectionBar } from "./picked-bar"
import { EmptyState } from "./empty-state"
import { ColumnMenu } from "./column-menu"
import { Checkbox } from "../primitives/checkbox"
import { Skeleton } from "../primitives/skeleton"
import { cn } from "../lib/utils"

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
}: DataTableProps<T>) {
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
  const selectedRow = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "nearest" })
  }, [selected, rows])

  const ids = rows?.map(rowId) ?? []
  const pickedCount = picked ? ids.filter((id) => picked.has(id)).length : 0
  const pickable = Boolean(onPick && picked)
  const bulking = Boolean(bulk && picked && picked.size > 0)
  const visibleColumns = table.getVisibleLeafColumns()
  const menuWidth = id ? 32 : 0
  const span = visibleColumns.length + (pickable ? 1 : 0) + (id ? 1 : 0)

  const widthOf = (column: { id: string; columnDef: ColumnDef<T, unknown> }) =>
    sizing[column.id] ?? column.columnDef.meta?.width
  const minWidth =
    (pickable ? 36 : 0) +
    menuWidth +
    visibleColumns.reduce((sum, column) => sum + (widthOf(column) ?? FLEX_MIN), 0)

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-xs"
          style={{ minWidth }}
        >
          <colgroup>
            {pickable && <col className="w-9" />}
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
                {pickable && (
                  <th className="h-8 pl-3.5 text-left align-middle">
                    <Checkbox
                      aria-label="모두 선택"
                      checked={
                        ids.length > 0 && pickedCount === ids.length
                          ? true
                          : pickedCount
                          ? "indeterminate"
                          : false
                      }
                      onCheckedChange={(checked) => onPick!(ids, Boolean(checked))}
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
                      className={cn(
                        "group/th relative h-8  px-3 text-left align-middle text-xs font-medium tracking-tight text-muted-foreground whitespace-nowrap",
                        index === 0 && !pickable && "pl-4",
                        header.column.columnDef.meta?.align === "end" && "text-right"
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {!header.isPlaceholder &&
                        header.column.columnDef.meta?.resizable !== false && (
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
            {loading || !rows
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={span} className="px-3.5 py-2">
                      <Skeleton
                        className="h-3.5"
                        style={{ width: `${55 + ((i * 17) % 35)}%` }}
                      />
                    </td>
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => {
                  const isSelected = row.id === selected
                  return (
                    <tr
                      key={row.id}
                      ref={isSelected ? selectedRow : undefined}
                      data-state={isSelected ? "selected" : undefined}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      className={cn(
                        "group/row transition-colors",
                        onRowClick && "cursor-pointer hover:bg-accent",
                        isSelected && "bg-selection hover:bg-selection",
                        rowClassName?.(row.original)
                      )}
                    >
                      {pickable && (
                        <td
                          className={cn(
                            "pl-3.5 align-middle py-2.5",
                            isSelected && ""
                          )}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            aria-label="선택"
                            checked={picked!.has(row.id)}
                            onCheckedChange={(checked) =>
                              onPick!([row.id], Boolean(checked))
                            }
                          />
                        </td>
                      )}
                      {row.getVisibleCells().map((cell, index) => {
                        const meta = cell.column.columnDef.meta
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "px-3 py-2.5 align-middle text-xs text-foreground",
                              index === 0 && !pickable && "pl-4",
                              index === 0 &&
                                !pickable &&
                                isSelected &&
                                "",
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
                    </tr>
                  )
                })}
          </tbody>
        </table>
        {!loading && rows && rows.length === 0 && (empty ?? <EmptyState noun="항목" />)}
      </div>
      {footer}
    </div>
  )
}
