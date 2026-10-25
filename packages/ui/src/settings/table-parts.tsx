import type * as React from "react"
import { cn } from "../lib/utils"
import { DataTable, type DataTableProps } from "../data/data-table"
import { SplitPane, type SplitPaneProps } from "../layout/split-pane"
import { StatusIcon } from "../tokens/status"

/** A table's frame: a hairline box with rounded corners that clips the table; `card` gives it the card surface. */
export function TablePanel({ card, children }: { card?: boolean; children: React.ReactNode }) {
  return <div className={cn("overflow-hidden rounded-md border border-border", card && "bg-card")}>{children}</div>
}

/** A data table that is as tall as its rows (inside a `TablePanel`, in a page that scrolls) instead of filling its parent. */
export function CompactDataTable<T>(props: DataTableProps<T>) {
  return <DataTable className="flex-none" {...props} />
}

/** A list page and its right-hand pane, filling the page's height. */
export function FullHeightSplitPane(props: SplitPaneProps) {
  return <SplitPane className="h-full" {...props} />
}

/** A cell's content in one line, icon and name 8px apart; `weight="medium"` for the row's name. */
export function CellInline({ weight, children }: { weight?: "medium"; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-2", weight === "medium" && "font-medium")}>{children}</span>
}

/** A status icon one step smaller than usual (10px), for a table cell. */
export function SmallStatusIcon(props: React.ComponentProps<typeof StatusIcon>) {
  return <StatusIcon className="size-2.5" {...props} />
}
