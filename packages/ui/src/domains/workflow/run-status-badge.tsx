import { cn } from "../../lib/utils"
import { Inline } from "../../primitives/stack"

const LABEL = {
  running: "실행 중",
  paused: "일시정지",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
} as const

/** Shape + colour per run state, like StatusIcon: running = accent ring, paused = review, failed = destructive, ended = quiet. */
const DOT = {
  running: "bg-accent",
  paused: "bg-review",
  completed: "bg-success",
  failed: "bg-danger",
  cancelled: "bg-neutral-subtle",
} as const

export interface RunStatusBadgeProps {
  status: keyof typeof LABEL
}

/** A run's state as a dot and its name. */
export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  return (
    <Inline as="span" inline gap="snug" variant="caption" weight="medium" nowrap>
      <span
        aria-hidden
        className={cn(
          "inline-block size-2 shrink-0",
          status === "failed" ? "rotate-45 rounded-[1px]" : "rounded-full",
          status === "running" && "animate-pulse",
          DOT[status]
        )}
      />
      <span>{LABEL[status]}</span>
    </Inline>
  )
}
