import { cn } from "../lib/utils"

export const JOB_STATUS_LABEL = {
  running: "실행 중",
  paused: "일시정지",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
} as const

export const JOB_STATUS_DOT = {
  running: "bg-primary",
  paused: "bg-warning",
  completed: "bg-muted-foreground/50",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/50",
} as const

export interface JobStatusBadgeProps {
  status: keyof typeof JOB_STATUS_LABEL
  className?: string
}

export function JobStatusBadge({ status, className }: JobStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xs border border-border/70 bg-background px-1.5 py-0.5 text-xs font-medium whitespace-nowrap shadow-2xs",
        className
      )}
    >
      <span
        aria-hidden
        className={cn("inline-block size-1.5 shrink-0 rounded-full", JOB_STATUS_DOT[status])}
      />
      <span>{JOB_STATUS_LABEL[status]}</span>
    </span>
  )
}
