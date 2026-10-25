import { Slot } from "@radix-ui/react-slot"
import { clsx } from "clsx"
import type * as React from "react"
import type { ElementTag } from "./tags"
import { GAP, type StyleProps, splitStyle, styleVariants } from "./style"

export type BoxProps = React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> } & StyleProps & {
  as?: ElementTag
  /** Puts the options on the one child instead of rendering an element (a router link, a trigger). */
  asChild?: boolean
  htmlFor?: string
  /** The gap between the children, for a part that is a flex or grid container of its own (a radio group): by spacing name. */
  gap?: keyof typeof GAP.gap
}

/**
 * A box with layout and text options only (padding, margin, surface, border, radius, size, overflow, type), by token name. It renders no
 * classes of its own: with no options it is a plain element. For a row or a column of children use `Stack` or `Inline`.
 */
export function Box({ as: Tag = "div", asChild, gap, className, ...props }: BoxProps) {
  const [style, rest] = splitStyle(props)
  const Element = (asChild ? Slot : Tag) as React.ElementType
  return <Element className={clsx(styleVariants(style), gap && GAP.gap[gap], className) || undefined} {...rest} />
}
