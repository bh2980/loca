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
}

export function SelectionBar({
  count,
  onClear,
  children,
  grow,
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
      )}
      role="toolbar"
      aria-label="선택한 항목 동작"
    >
      <span className="shrink-0 font-semibold text-default tabular-nums">
        {count.toLocaleString()}개
        <span className="hidden @md/picked:inline font-normal text-muted"> 선택됨</span>
      </span>
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
