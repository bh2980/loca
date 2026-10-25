import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight, EyeOff, X } from "lucide-react"
import { Button } from "../controls/button"
import { cn } from "../lib/utils"
import { chipStyle } from "./palette"

export interface FilterBarProps {
  children?: ReactNode
  end?: ReactNode
}

/**
 * One-line filter row: filters on the left, count and display controls on the right.
 */
export function FilterBar({
  children,
  end,
}: FilterBarProps) {
  return (
    <div className="flex min-h-9 shrink-0 flex-nowrap items-center gap-1.5 overflow-hidden border-b border-default bg-surface px-3 py-1 backdrop-blur-xs">
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden">{children}</div>
      {end != null && <div className="ml-auto flex min-w-0 shrink-0 flex-nowrap items-center gap-1.5">{end}</div>}
    </div>
  )
}

export interface PagerProps {
  page: number
  total: number
  pageSize: number
  onPage: (page: number) => void
}

export function Pager({ page, total, pageSize, onPage }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null

  return (
    <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-default bg-page/50 px-3 py-1.5">
      <span className="text-2xs text-muted tabular-nums">
        {(page * pageSize + 1).toLocaleString()}–{Math.min(total, (page + 1) * pageSize).toLocaleString()} / {total.toLocaleString()}
      </span>
      <Button
        variant="outline"
        size="icon-xs"
        aria-label="이전 페이지"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        aria-label="다음 페이지"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

export interface FilterChip {
  key: string
  label: ReactNode
  name?: string
  /** A tag or mark filter: the chip takes the tag's own colour (one pill, its × inside), not a pill in a pill. */
  color?: string
  /** A 숨기기 pick: rows that have it are left out; shown with an eye shut. */
  hidden?: boolean
  clear: () => void
}

export function FilterChips({ chips }: { chips: FilterChip[] }) {
  return chips.map((chip) => (
    <Button
      key={chip.key}
      variant="secondary"
      size="xs"
      onClick={chip.clear}
      aria-label={`${chip.name ?? chip.label} ${chip.hidden ? '숨김' : '필터'} 지우기`}
      className={cn("h-6 gap-1 rounded-md px-2 text-xs", chip.color ? "font-medium hover:opacity-80" : "font-normal")}
      style={chip.color ? chipStyle(chip.color) : undefined}
    >
      {chip.hidden && <EyeOff className="size-3" aria-label="숨김" />}
      {chip.label} <X className="size-3 opacity-60" />
    </Button>
  ))
}
