import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "../controls/button"
import { cn } from "../lib/utils"
import { useToolbarRoving } from "../lib/use-toolbar-roving"

export interface SelectionBarProps {
  count: number
  onClear: () => void
  children?: ReactNode
  /** Takes the rest of its row (a bar in the head row of a list). */
  grow?: boolean
  /**
   * Everything on the page is picked and the list has more (Gmail's rule): a way to pick all of them, said next to the
   * count ("필터에 맞는 41줄 모두 고르기").
   */
  more?: { label: string; onSelect: () => void }
  /** Laid over a canvas (a graph's picked nodes): the bar brings its own surface instead of sitting in a row that has one. */
  floating?: boolean
}

export function SelectionBar({
  count,
  onClear,
  children,
  grow,
  more,
  floating,
}: SelectionBarProps) {
  const { rootRef, onKeyDown } = useToolbarRoving([children, count])
  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className={cn(
        "@container/picked flex min-w-0 flex-wrap items-center gap-2 text-xs",
        // Actions here sit in a table header or toolbar row of about their own height: borderless and
        // one step shorter, so they read as text actions rather than boxes crammed into the row.
        "[&_button:not([role=checkbox])]:h-6!",
        // A primary (default) button keeps its fill: stripping it would leave white text on nothing.
        "[&_button:not([role=checkbox],[data-variant=default])]:border-transparent! [&_button:not([role=checkbox],[data-variant=default])]:bg-transparent! [&_button:not([role=checkbox],[data-variant=default])]:shadow-none! [&_button:not([role=checkbox],[data-variant=default]):hover]:bg-hover!",
        grow && "flex-1 pr-4",
        floating && "max-w-full rounded-md border border-default bg-surface py-1 pr-1 pl-2 shadow-2xs backdrop-blur-xs select-none",
      )}
      role="toolbar"
      aria-label="선택한 항목 동작"
    >
      <span className="shrink-0 font-semibold text-default tabular-nums">
        {count.toLocaleString()}개
        <span className="hidden @md/picked:inline font-normal text-muted"> 선택됨</span>
      </span>
      {more && <Button variant="ghost" size="xs" className="shrink-0 text-accent" onClick={more.onSelect}>{more.label}</Button>}
      {children}
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto shrink-0 text-muted hover:text-default"
        aria-label="선택 해제"
        title="선택 해제"
        onClick={onClear}
      >
        <X className="size-3" />
        <span className="hidden @xl/picked:inline">선택 해제</span>
      </Button>
    </div>
  )
}
