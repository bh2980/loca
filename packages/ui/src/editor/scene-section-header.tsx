import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export function SceneSectionHeader({ title, count, trailing, className }: { title: ReactNode; count?: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <header className={cn("group/scene-section flex min-w-0 items-center gap-2 pl-[46px] pr-3 pt-5 pb-2 text-xs", className)}>
      <span className="min-w-0 truncate font-semibold text-foreground">{title}</span>
      {count !== undefined && <span className="shrink-0 tabular-nums text-subtle-foreground">{count}</span>}
      {trailing && <span className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/scene-section:opacity-100 group-focus-within/scene-section:opacity-100">{trailing}</span>}
    </header>
  )
}
