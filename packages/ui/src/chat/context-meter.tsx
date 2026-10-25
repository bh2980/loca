import type * as React from "react"
import { cn } from "../lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip"

/** "문맥 N%": how much of the model's window the last answer used; `high` is stronger, `full` is danger. `children` are the numbers in the tooltip. */
export function ContextMeterView({ percent, level, children }: { percent: number; level: "ok" | "high" | "full"; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} role="status" aria-label={`문맥 ${percent}% 사용`} className={cn("shrink-0 rounded-sm px-1 text-xs tabular-nums text-muted-foreground", level === "high" && "text-foreground", level === "full" && "text-destructive")}>
          문맥 {percent}%
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-0.5">{children}</TooltipContent>
    </Tooltip>
  )
}
