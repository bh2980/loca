import { Sparkles } from "lucide-react"
import { paletteIndex } from "@tw/shared"
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip"
import { cn } from "../lib/utils"

/**
 * Statuses, tags and marks (docs/DESIGN.md 4.0). The one place their colours and shapes are drawn:
 * screens use these parts, never a coloured span of their own.
 */
export interface StatusLike {
  id: string
  name: string
  color: string
  /** initial = not started (empty ring), final = done (check), anything else = in progress. */
  kind?: "initial" | "normal" | "final"
  /** Lines in it wait for a person (filled with !). */
  inReview?: boolean
}

/**
 * A stored colour as the theme shows it: a palette colour (or one of the old Tailwind colours) becomes its
 * hue variable, tuned per theme; any other hex is used as is.
 */
export function paletteColor(hex: string | null | undefined): string {
  if (!hex) return "var(--hue-1)"
  const index = paletteIndex(hex)
  return index >= 0 ? `var(--hue-${index + 1})` : hex
}

type StatusShape = "empty" | "half" | "review" | "done"
const shapeOf = (status?: Pick<StatusLike, "kind" | "inReview"> | null): StatusShape =>
  !status || status.kind === "initial" ? "empty" : status.kind === "final" ? "done" : status.inReview ? "review" : "half"

/**
 * A status as shape + colour, so it reads without colour too: empty ring = not started, half = in progress,
 * filled with ! = waiting for a person, filled with ✓ = done. Decorative next to the status name; give
 * `label` when it stands alone.
 */
export function StatusIcon({
  status,
  label,
  className,
}: {
  status?: Pick<StatusLike, "color" | "kind" | "inReview"> | null
  label?: string
  className?: string
}) {
  const shape = shapeOf(status)
  const color = paletteColor(status?.color)
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn("size-3 shrink-0", className)}
      style={{ color }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {shape === "empty" && <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={status ? undefined : "2 1.6"} />}
      {shape === "half" && (
        <>
          <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 2.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      )}
      {shape === "review" && (
        <>
          <circle cx="6" cy="6" r="5.5" fill="currentColor" />
          <path d="M6 3.2v3.3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="6" cy="8.6" r="0.85" fill="white" />
        </>
      )}
      {shape === "done" && (
        <>
          <circle cx="6" cy="6" r="5.5" fill="currentColor" />
          <path d="M3.6 6.2 5.3 7.8 8.4 4.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}

/** A status as icon + name. Colour is never the only signal. */
export function StatusBadge({ status, className }: { status?: StatusLike; className?: string }) {
  if (!status) return <span className="text-xs text-subtle-foreground">—</span>
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-foreground", className)}>
      <StatusIcon status={status} />
      {status.name}
    </span>
  )
}

/** A tag's chip colours: a light tint behind text mixed toward the foreground, so it stays readable in both themes. */
export const chipStyle = (color: string) => {
  const hue = paletteColor(color)
  return {
    backgroundColor: `color-mix(in oklab, ${hue} 14%, transparent)`,
    color: `color-mix(in oklab, ${hue} 62%, var(--foreground))`,
  }
}

export function TagChip({ tag, className }: { tag: Pick<StatusLike, "name" | "color">; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", className)} style={chipStyle(tag.color)}>
      #{tag.name}
    </span>
  )
}

/** Stacked bar of line counts per status (the status meter). */
export function StatusBar({ statuses, counts, className }: { statuses: StatusLike[]; counts: Record<string, number>; className?: string }) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return (
    <div
      className={cn("flex h-1 w-full gap-px overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={statuses.map((status) => `${status.name} ${counts[status.id] ?? 0}`).join(", ")}
    >
      {total > 0 &&
        statuses.map((status) =>
          counts[status.id] ? <div key={status.id} style={{ width: `${(counts[status.id] / total) * 100}%`, backgroundColor: paletteColor(status.color) }} /> : null
        )}
    </div>
  )
}

/**
 * ✦ beside a status or 확정 that AI set and no person has looked at since (docs/DESIGN.md 3.5).
 * The same mark everywhere: lines, knowledge, terms. Renders nothing when a person set it.
 */
export function AiMark({ by, className }: { by: "ai" | "human" | null | undefined; className?: string }) {
  if (by !== "ai") return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label="AI 초안" className={cn("inline-flex shrink-0 text-ai", className)}>
          <Sparkles className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>AI 초안 · 아직 사람이 확인하지 않음</TooltipContent>
    </Tooltip>
  )
}
