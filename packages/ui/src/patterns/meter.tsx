import { paletteColor } from "./palette"
import type { StatusLike } from "./status"

const SIZE = { sm: "h-1", md: "h-1.5" } as const

const WIDTH = {
  /** Fills its row. */
  full: "w-full",
  /** A small fixed length that never shrinks (a status bar). */
  compact: "w-20 shrink-0",
} as const

/**
 * A stacked bar of counts per status (the status meter): each status that has lines takes its share of the bar in its own color.
 * Statuses that mean "not started" are left out, so the bar shows how far along things are.
 */
export function Meter({ statuses, counts, size = "sm", width = "full" }: {
  statuses: StatusLike[]
  counts: Record<string, number>
  size?: keyof typeof SIZE
  width?: keyof typeof WIDTH
}) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return (
    <div
      className={`flex ${SIZE[size]} ${WIDTH[width]} gap-px overflow-hidden rounded-full bg-meter-track`}
      role="img"
      aria-label={statuses.map((status) => `${status.name} ${counts[status.id] ?? 0}`).join(", ")}
    >
      {total > 0 &&
        statuses.map((status) => {
          const isInitial = status.kind === "initial" || status.name === "미번역"
          if (isInitial || !counts[status.id]) return null
          return (
            <div
              key={status.id}
              style={{ width: `${(counts[status.id] / total) * 100}%`, backgroundColor: paletteColor(status.color) }}
            />
          )
        })}
    </div>
  )
}
