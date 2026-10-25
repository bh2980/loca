import { cva, type VariantProps } from "class-variance-authority"
import { clsx } from "clsx"
import { Slot } from "@radix-ui/react-slot"
import type * as React from "react"
import { GAP, type StyleProps, splitStyle, styleVariants } from "./style"
import type { ElementTag } from "./tags"

/**
 * Lays out its children in a column (the default) or a row. `gap` takes the spacing names (see `SPACING_PX` in style.ts: tight 4px,
 * condensed 8px, normal 12px, ...); with no gap there is none. `align` is the cross axis (items), `justify` the main axis.
 */
export const stackVariants = cva("", {
  variants: {
    /** `inline` makes the container itself sit in a line of text (inline-flex). */
    inline: { true: "inline-flex", false: "flex" },
    direction: { column: "flex-col", row: "" },
    gap: GAP.gap,
    gapX: GAP.gapX,
    gapY: GAP.gapY,
    align: { start: "items-start", center: "items-center", end: "items-end", baseline: "items-baseline", stretch: "items-stretch" },
    justify: { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" },
    wrap: { true: "flex-wrap" },
  },
  defaultVariants: { direction: "column", inline: false },
})

export type StackProps = React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> } & VariantProps<typeof stackVariants> &
  StyleProps & {
    as?: ElementTag
    /** Puts the flex options on the one child instead of rendering an element (a router link that lays out its content). */
    asChild?: boolean
    htmlFor?: string
  }

export function Stack({ as: Tag = "div", asChild, direction, inline, gap, gapX, gapY, align, justify, wrap, className, ...props }: StackProps) {
  const [style, rest] = splitStyle(props)
  const Element = (asChild ? Slot : Tag) as React.ElementType
  return <Element className={clsx(stackVariants({ direction, inline, gap, gapX, gapY, align, justify, wrap }), styleVariants(style), className)} {...rest} />
}

/** Children side by side: a `Stack` in a row, centered on the cross axis by default (an icon and its label, a toolbar). */
export function Inline({ align = "center", ...props }: Omit<StackProps, "direction">) {
  return <Stack direction="row" align={align} {...props} />
}
