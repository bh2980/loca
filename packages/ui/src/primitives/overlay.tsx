import { clsx } from "clsx"
import { Box, type BoxProps } from "./box"

/** Fills the nearest positioned ancestor (a canvas, a graph area): a status, an empty state or a loading note laid over it. */
export function Overlay({ className, ...props }: BoxProps) {
  return <Box className={clsx("absolute inset-0", className)} {...props} />
}

/**
 * One row of a virtualized list: placed at the top of the list's relative box and moved down by the virtualizer (`style.transform`),
 * as wide as the list.
 */
export function VirtualItem({ className, ...props }: BoxProps) {
  return <Box className={clsx("absolute top-0 left-0 w-full", className)} {...props} />
}

const BLEED = { tight: "-mx-1", snug: "-mx-1.5", condensed: "-mx-2" } as const

/** A block that reaches past its parent's side padding by this much (a scrolling list that leaves room for focus rings, an editor card). */
export function Bleed({ by, className, ...props }: BoxProps & { by: keyof typeof BLEED }) {
  return <Box className={clsx(BLEED[by], className)} {...props} />
}
