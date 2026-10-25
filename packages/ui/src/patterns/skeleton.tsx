import * as React from "react"
import { cn } from "../lib/utils"
import { splitStyle, styleVariants, type StyleProps } from "../primitives/style"

const SHAPE = {
  /** One line of text. */
  line: "h-3.5",
  /** A row of a list. */
  row: "h-10",
  /** A card. */
  card: "h-24",
  /** The body of a pane that loads as a whole. */
  page: "h-64",
} as const

export type SkeletonProps = Omit<React.ComponentProps<"div">, "className"> &
  StyleProps & {
    /** The height it stands in for; `height` overrides it. */
    shape?: keyof typeof SHAPE
    /** How many placeholders to draw. */
    count?: number
  }

/** A pulsing placeholder for what is still loading. Give the `shape` it stands in for, or its own `width` and `height`. */
function Skeleton({ shape, count = 1, ...props }: SkeletonProps) {
  const [style, rest] = splitStyle(props)
  const className = cn("animate-pulse rounded-xs bg-sunken", shape && !style.height && SHAPE[shape], styleVariants(style))
  return Array.from({ length: count }, (_, index) => <div key={index} data-slot="skeleton" className={className} {...rest} />)
}

export { Skeleton }
