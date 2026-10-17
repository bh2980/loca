import type { ReactNode } from "react"
import { Sparkles } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip"
import { cn } from "../lib/utils"

export interface StatusLike {
  id: string
  name: string
  color: string
}

export function StatusDot({
  color,
  className,
}: {
  color: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  )
}

/** Status pill: crisp 1px border, 3px radius, dot + label. */
export function StatusBadge({
  status,
  className,
}: {
  status?: StatusLike
  className?: string
}) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-border/70 bg-background px-1.5 py-0.5 text-xs font-medium whitespace-nowrap shadow-2xs",
        className
      )}
    >
      <StatusDot color={status.color} />
      <span>{status.name}</span>
    </span>
  )
}

/** Color calculation for tag chips. */
export const chipStyle = (color: string) => ({
  backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
  color: `color-mix(in oklab, ${color} 60%, var(--foreground))`,
})

export function TagChip({
  tag,
  className,
}: {
  tag: StatusLike
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium border border-transparent shadow-2xs",
        className
      )}
      style={chipStyle(tag.color)}
    >
      #{tag.name}
    </span>
  )
}

export function StatusBar({
  statuses,
  counts,
  className,
}: {
  statuses: StatusLike[]
  counts: Record<string, number>
  className?: string
}) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return (
    <div
      className={cn(
        "flex h-1.5 w-full overflow-hidden rounded-xs bg-muted/60",
        className
      )}
      role="img"
      aria-label={statuses
        .map((status) => `${status.name} ${counts[status.id] ?? 0}`)
        .join(", ")}
    >
      {total > 0 &&
        statuses.map((status) =>
          counts[status.id] ? (
            <div
              key={status.id}
              style={{
                width: `${(counts[status.id] / total) * 100}%`,
                backgroundColor: status.color,
              }}
            />
          ) : null
        )}
    </div>
  )
}

export function AiMark({
  by,
  className,
}: {
  by: "ai" | "human" | null | undefined
  className?: string
}) {
  if (by !== "ai") return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label="AI가 정함"
          className={cn("inline-flex shrink-0 text-muted-foreground", className)}
        >
          <Sparkles className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>AI가 정함 · 아직 사람이 확인하지 않음</TooltipContent>
    </Tooltip>
  )
}
