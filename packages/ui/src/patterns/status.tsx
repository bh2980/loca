import { Sparkles } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip"
import { cn } from "../lib/utils"
import { Chip } from "./chip"
import { paletteColor } from "./palette"

/**
 * Statuses, tags and marks. The one place their colours and shapes are drawn:
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
  small,
}: {
  status?: Pick<StatusLike, "color" | "kind" | "inReview"> | null
  label?: string
  /** One step smaller (10px), for a table cell. */
  small?: boolean
}) {
  const shape = shapeOf(status)
  const color = paletteColor(status?.color)
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn("size-3 shrink-0", small && "size-2.5")}
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

/** A tag as `#name` on a chip in its own colour. */
export function TagChip({ tag }: { tag: Pick<StatusLike, "name" | "color"> }) {
  return (
    <Chip variant="tint" color={tag.color}>
      #{tag.name}
    </Chip>
  )
}

/**
 * ✦ beside a status or 확정 that AI set and no person has looked at since.
 * The same mark everywhere: lines, knowledge, terms. Renders nothing when a person set it.
 */
export function AiMark({ by }: { by: "ai" | "human" | null | undefined }) {
  if (by !== "ai") return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label="AI 초안" className={"inline-flex shrink-0 text-ai"}>
          <Sparkles className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>AI 초안 · 아직 사람이 확인하지 않음</TooltipContent>
    </Tooltip>
  )
}
