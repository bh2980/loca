import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/** Compact source/context pair with an optional translation, for nearby lines and dialogue context. */
export function ContextLine({ speaker, source, translation, current = false, className }: {
  speaker: ReactNode
  source: ReactNode
  translation?: ReactNode
  current?: boolean
  className?: string
}) {
  return (
    <div className={cn("grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-x-3 rounded-md px-2 py-1.5", current && "bg-selection/60", className)}>
      <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">{speaker}</div>
      <div className="min-w-0 space-y-1 text-sm leading-5">
        <div className="line-clamp-2">{source}</div>
        {translation != null && <div className="line-clamp-2 text-muted-foreground">{translation}</div>}
      </div>
    </div>
  )
}
