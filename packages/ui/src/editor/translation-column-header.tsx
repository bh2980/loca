import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/** Quiet column labels aligned to TranslationRow, or a full-width bulk selection toolbar. */
export function TranslationColumnHeader({ checkbox, source, translation, selection, className }: {
  checkbox?: ReactNode
  source?: ReactNode
  translation?: ReactNode
  selection?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid min-h-10 grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 bg-background px-3 py-1.5 text-xs text-muted-foreground", className)}>
      <span className="flex justify-center">{checkbox}</span>
      {selection ? (
        <div className="col-span-2 min-w-0">{selection}</div>
      ) : (
        <>
          <span className="min-w-0 truncate">{source}</span>
          <span className="min-w-0 truncate">{translation}</span>
        </>
      )}
    </div>
  )
}
