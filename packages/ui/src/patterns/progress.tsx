import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

const TONE = {
  accent: { fill: "bg-accent", track: "bg-accent/20" },
  danger: { fill: "bg-danger", track: "bg-danger/20" },
  warning: { fill: "bg-warning", track: "bg-warning/20" },
  success: { fill: "bg-success", track: "bg-success/20" },
} as const

const SIZE = { sm: "h-1", md: "h-1.5" } as const

const GROW = {
  /** Fills the room left in a row. */
  true: "flex-1",
  /** Fills the room left in a row, but is at least 4rem long. */
  reserve: "min-w-16 flex-1",
} as const

type ProgressProps = Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "className" | "value" | "asChild"> & {
  /** 0 to 100. */
  value?: number
  tone?: keyof typeof TONE
  size?: keyof typeof SIZE
  /** Takes the room of a row. */
  grow?: boolean | "reserve"
  /** Shows that something is under way without saying how far (a bar that moves). */
  indeterminate?: boolean
}

/** A bar for how far a run or job is; `indeterminate` moves instead of sitting at 0 while one long step is under way. */
function Progress({ value, tone = "accent", size = "md", grow, indeterminate, ...props }: ProgressProps) {
  const layout = `${SIZE[size]} w-full${grow ? ` ${GROW[grow === true ? "true" : grow]}` : ""}`
  if (indeterminate)
    return (
      <div className={`relative ${layout} overflow-hidden rounded-full ${TONE[tone].track}`} role="progressbar" aria-label="진행 중">
        <div className={`absolute inset-y-0 w-2/5 rounded-full ${TONE[tone].fill}`} style={{ animation: "indeterminate 1.4s ease-in-out infinite" }} />
      </div>
    )
  return (
    <ProgressPrimitive.Root data-slot="progress" className={`relative ${layout} overflow-hidden rounded-full bg-meter-track`} {...props}>
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={`h-full w-full flex-1 ${TONE[tone].fill} transition-all duration-300 ease-in-out`}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
