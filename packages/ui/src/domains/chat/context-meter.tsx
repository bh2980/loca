import type * as React from "react"
import { cn } from "../../lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../controls/tooltip"

/** "문맥 N%": how much of the model's window the last answer used; `high` is stronger, `full` is danger. `children` are the numbers in the tooltip. */
/** `percent` null: the size of the window used is not known (the tooltip says why). */
export function ContextMeterView({ percent, level, children }: { percent: number | null; level: "ok" | "high" | "full"; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} role="status" aria-label={percent === null ? "문맥 사용량 모름" : `문맥 ${percent}% 사용`} className={cn("shrink-0 rounded-sm px-1 text-xs tabular-nums text-muted", level === "high" && "text-warning", level === "full" && "text-danger")}>
          문맥 {percent === null ? "–" : `${percent}%`}
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-0.5">{children}</TooltipContent>
    </Tooltip>
  )
}
