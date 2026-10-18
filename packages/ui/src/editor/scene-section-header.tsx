import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export function SceneSectionHeader({ title, count, checkbox, trailing, className }: { title: ReactNode; count?: ReactNode; checkbox?: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <header className={cn("group/scene-section min-w-0 items-center gap-2 pr-3 pt-5 pb-2 text-xs", checkbox ? "flex pl-0" : "flex pl-[46px]", className)}>
      {checkbox && <span className="flex w-6 justify-center">{checkbox}</span>}
      <span className="min-w-0 truncate font-semibold text-foreground">{title}</span>
      {count !== undefined && <span className="shrink-0 tabular-nums text-subtle-foreground">{count}</span>}
      {trailing && <span className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/scene-section:opacity-100 group-focus-within/scene-section:opacity-100">{trailing}</span>}
    </header>
  )
}
