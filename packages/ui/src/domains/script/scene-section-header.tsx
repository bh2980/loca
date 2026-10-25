import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

export function SceneSectionHeader({ title, count, checkbox, trailing }: { title: ReactNode; count?: ReactNode; checkbox?: ReactNode; trailing?: ReactNode }) {
  return (
    <header className={cn("group/scene-section min-w-0 items-center gap-2 rounded-md bg-sunken/50 pr-3 py-2 text-sm ring-1 ring-inset ring-line", checkbox ? "flex pl-0" : "flex pl-[46px]")}>
      {checkbox && <span className="flex w-6 justify-center">{checkbox}</span>}
      <span className="min-w-0 truncate font-semibold text-default">{title}</span>
      {count !== undefined && <span className="shrink-0 tabular-nums text-subtle">{count}</span>}
      {trailing && <span className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/scene-section:opacity-100 group-focus-within/scene-section:opacity-100">{trailing}</span>}
    </header>
  )
}
