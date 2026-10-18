import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"
import { useToolbarRoving } from "../lib/use-toolbar-roving"

export interface SelectionBarProps {
  count: number
  onClear: () => void
  children?: ReactNode
  className?: string
}

export function SelectionBar({
  count,
  onClear,
  children,
  className,
}: SelectionBarProps) {
  const { rootRef, onKeyDown } = useToolbarRoving([children, count])
  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className={cn(
        "@container/picked flex min-w-0 flex-wrap items-center gap-2 text-xs",
        className,
      )}
      role="toolbar"
      aria-label="선택한 항목 동작"
    >
      <span className="shrink-0 font-semibold text-foreground tabular-nums">
        {count.toLocaleString()}개
        <span className="hidden @md/picked:inline font-normal text-muted-foreground"> 선택됨</span>
      </span>
      {children}
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
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

export function SelectionLabel({
  children,
  from = "md",
}: {
  children: ReactNode
  from?: "md" | "lg"
}) {
  return (
    <span
      className={
        from === "lg"
          ? "hidden @lg/picked:inline"
          : "hidden @md/picked:inline"
      }
    >
      {children}
    </span>
  )
}
