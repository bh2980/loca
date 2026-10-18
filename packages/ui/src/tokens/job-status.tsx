import { cn } from "../lib/utils"

export const JOB_STATUS_LABEL = {
  running: "실행 중",
  paused: "일시정지",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
} as const

/** Shape + colour per run state, like StatusIcon: running = accent ring, paused = review, failed = destructive, ended = quiet. */
export const JOB_STATUS_DOT = {
  running: "bg-primary",
  paused: "bg-review",
  completed: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-subtle-foreground",
} as const

export interface JobStatusBadgeProps {
  status: keyof typeof JOB_STATUS_LABEL
  className?: string
}

export function JobStatusBadge({ status, className }: JobStatusBadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", className)}>
      <span
        aria-hidden
        className={cn(
          "inline-block size-2 shrink-0",
          status === "failed" ? "rotate-45 rounded-[1px]" : "rounded-full",
          status === "running" && "animate-pulse",
          JOB_STATUS_DOT[status]
        )}
      />
      <span>{JOB_STATUS_LABEL[status]}</span>
    </span>
  )
}
