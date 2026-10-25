import type { ComponentProps } from "react"
import { cn } from "../lib/utils"
import { SearchInput } from "../layout/toolbar"
import { SelectionBar } from "../data/picked-bar"
import { EmptyState } from "../data/empty-state"
import { Input } from "../primitives/input"
import { Skeleton } from "../primitives/skeleton"
import { SelectTrigger } from "../primitives/select"
import { ContextMenuContent } from "../primitives/context-menu"
import { DropdownMenuContent, DropdownMenuLabel, DropdownMenuSubContent } from "../primitives/dropdown-menu"
import { StatusBar } from "../tokens/status"

const TRIGGER_WIDTH = { narrow: "w-24 shrink-0", medium: "w-28 shrink-0", field: "w-40", full: "w-full" } as const

/** A select trigger of a set width: narrow (24), medium (28), a form field (40), or the full row. */
export function ScriptSelectTrigger({ width, ...props }: ComponentProps<typeof SelectTrigger> & { width: keyof typeof TRIGGER_WIDTH }) {
  return <SelectTrigger {...props} className={TRIGGER_WIDTH[width]} />
}

/** The select trigger that reads as the speaker row's text: `unknown` shows it in the warning color. */
export function ScriptInlineListenerTrigger({ unknown, label, ...props }: Omit<ComponentProps<typeof SelectTrigger>, "children" | "className"> & { unknown: boolean; label: string }) {
  return (
    <SelectTrigger
      {...props}
      className={cn("h-auto min-w-0 gap-0.5 border-0 data-[size=default]:h-auto bg-transparent p-0 text-xs shadow-none hover:underline dark:bg-transparent dark:hover:bg-transparent [&>svg]:size-3", unknown ? "text-warning" : "text-muted-foreground")}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate"><span className="truncate">→ {label}</span></span>
    </SelectTrigger>
  )
}

const INPUT_PLACE = {
  /** A typed listener name in the bulk bar. */
  bulkName: "h-8 w-40",
  /** A typed listener name inside a speaker row. */
  inlineName: "h-6 w-36 text-xs",
  /** A typed listener name as a form field. */
  name: "w-40",
  /** A line's note under its editor. */
  note: "mt-2",
  /** A search box at the top of a menu. */
  menuSearch: "mb-1",
} as const

/** A text input for the line list's places: where it sits sets its size and margin. */
export function ScriptInput({ place, ...props }: ComponentProps<typeof Input> & { place: keyof typeof INPUT_PLACE }) {
  return <Input {...props} className={INPUT_PLACE[place]} />
}

/** The search box of the line list's toolbar (`toolbar`) or of the scene list (`fill`, the pane's width). */
export function ScriptSearchField({ width, ...props }: Omit<ComponentProps<typeof SearchInput>, "className"> & { width: "toolbar" | "fill" }) {
  return <SearchInput {...props} className={width === "toolbar" ? "w-56" : "w-full"} />
}

/** The picked lines' bar in the list's head row: it takes the rest of the row. */
export function ScriptSelectionBar(props: Omit<ComponentProps<typeof SelectionBar>, "className">) {
  return <SelectionBar {...props} className="flex-1 pr-4" />
}

/** The empty line list: roomier than the default. */
export function ScriptEmptyState(props: Omit<ComponentProps<typeof EmptyState>, "className">) {
  return <EmptyState {...props} className="py-16" />
}

/** A placeholder row while lines load. */
export function ScriptRowSkeleton() {
  return <Skeleton className="h-10" />
}

/** A scene's status meter under its name in the scene list. */
export function ScriptStatusMeter(props: Omit<ComponentProps<typeof StatusBar>, "className">) {
  return <StatusBar {...props} className="h-1 w-full" />
}

/** A line's menu, opened from ⋯ or a right-click. */
export function ScriptLineMenuContent(props: Omit<ComponentProps<typeof DropdownMenuContent>, "className">) {
  return <DropdownMenuContent {...props} className="w-52" />
}

/** A submenu of a line's menu: `wide` (status list) or `narrow` (translate or not). */
export function ScriptLineSubmenuContent({ size, ...props }: Omit<ComponentProps<typeof DropdownMenuSubContent>, "className"> & { size: "wide" | "narrow" }) {
  return <DropdownMenuSubContent {...props} className={size === "wide" ? "w-44" : "w-36"} />
}

/** A filter menu of the line list: scrolls when long. `width` 56 or 60 (Tailwind steps). */
export function ScriptFilterMenuContent({ width, ...props }: Omit<ComponentProps<typeof DropdownMenuContent>, "className"> & { width: "narrow" | "wide" }) {
  return <DropdownMenuContent {...props} className={cn("max-h-[70svh] overflow-y-auto", width === "narrow" ? "w-56" : "w-60")} />
}

/** The listener submenu of the speaker filter. */
export function ScriptFilterSubmenuContent(props: Omit<ComponentProps<typeof DropdownMenuSubContent>, "className">) {
  return <DropdownMenuSubContent {...props} className="max-h-[70svh] w-56 overflow-y-auto" />
}

/** The quiet heading of a group inside a filter menu. */
export function ScriptFilterGroupLabel(props: Omit<ComponentProps<typeof DropdownMenuLabel>, "className">) {
  return <DropdownMenuLabel {...props} className="text-xs font-normal text-muted-foreground" />
}

/** A scene's right-click menu in the scene list. */
export function ScriptGroupMenuContent(props: Omit<ComponentProps<typeof ContextMenuContent>, "className">) {
  return <ContextMenuContent {...props} className="w-48" />
}
