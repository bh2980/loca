import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface PickedBarProps {
  count: number
  onClear: () => void
  children?: ReactNode
  className?: string
}

export function PickedBar({
  count,
  onClear,
  children,
  className,
}: PickedBarProps) {
  return (
    <div
      className={cn(
        "@container/picked flex min-w-0 flex-wrap items-center gap-2 text-xs",
        className
      )}
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

export function PickedLabel({
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
