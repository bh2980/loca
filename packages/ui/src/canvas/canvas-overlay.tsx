import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/** Shared, stacked header region for canvas search, filters, and status details. */
export function CanvasOverlay({ tools, details, className }: { tools: ReactNode; details?: ReactNode; className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col items-start gap-1.5", className)}>
      <div className="flex w-fit max-w-full min-w-0 flex-wrap items-start gap-1.5 pointer-events-auto">{tools}</div>
      {details && <div className="flex max-w-full flex-col items-start gap-1.5 pointer-events-auto">{details}</div>}
    </div>
  )
}
