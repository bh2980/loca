import { cn } from "../lib/utils"
import { Progress } from "../primitives/progress"

/**
 * Progress of a run or job. Counted when there is something to count; while a single long step is under way (one model call reading
 * the whole script) the bar moves instead of sitting at 0. `grow` lets it fill a row (at least 4rem).
 */
export function JobProgressBar({ done, total, running, grow = false }: { done: number; total: number; running: boolean; grow?: boolean }) {
  const className = grow ? "min-w-16 flex-1" : undefined
  if (running && done === 0 && total <= 1)
    return (
      <div className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20", className)} role="progressbar" aria-label="진행 중">
        <div className="absolute inset-y-0 w-2/5 rounded-full bg-primary" style={{ animation: "indeterminate 1.4s ease-in-out infinite" }} />
      </div>
    )
  return <Progress value={total ? (done / total) * 100 : 0} className={cn("h-1.5", className)} />
}
