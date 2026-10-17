import { useEffect, useState } from "react"
import { Progress } from "../primitives/progress"
import { cn } from "../lib/utils"

export function Elapsed({
  since,
  until,
  className,
}: {
  since: Date | string
  until?: Date | string | null
  className?: string
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (until) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])

  const seconds = Math.max(
    0,
    Math.round(
      ((until ? new Date(until).getTime() : now) - new Date(since).getTime()) / 1000
    )
  )

  return (
    <span className={cn("tabular-nums text-xs", className)}>
      {seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`}
    </span>
  )
}

export function JobProgress({
  done,
  total,
  running,
  className,
}: {
  done: number
  total: number
  running: boolean
  className?: string
}) {
  if (running && done === 0 && total <= 1) {
    return (
      <div
        className={cn(
          "relative h-1.5 w-full overflow-hidden rounded-xs bg-primary/20",
          className
        )}
        role="progressbar"
        aria-label="진행 중"
      >
        <div
          className="absolute inset-y-0 w-2/5 rounded-xs bg-primary"
          style={{ animation: "indeterminate 1.4s ease-in-out infinite" }}
        />
      </div>
    )
  }

  return (
    <Progress
      value={total ? (done / total) * 100 : 0}
      className={cn("h-1.5 rounded-xs", className)}
    />
  )
}
