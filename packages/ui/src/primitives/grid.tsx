import { cva, type VariantProps } from "class-variance-authority"
import { clsx } from "clsx"
import type * as React from "react"
import { GAP, type StyleProps, splitStyle, styleVariants } from "./style"
import type { ElementTag } from "./tags"

/**
 * Children in columns. `columns` is a count, or `field`: a 5rem label column next to the value (a list of labelled fields), or `twoFromSm`: one column that becomes two from the sm breakpoint, or `labelAndControl`: a label and a slightly wider control (a row of a mapping list). `responsive`
 * stacks the columns on a narrow screen (off by default). The gap takes the spacing names, as in `Stack`.
 */
const gridVariants = cva("grid", {
  variants: {
    columns: { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", field: "grid-cols-[5rem_1fr]", fieldShrink: "grid-cols-[5rem_minmax(0,1fr)]", labelAndControl: "grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]", twoFromSm: "sm:grid-cols-2" },
    responsive: { true: "max-md:grid-cols-1" },
    gap: GAP.gap,
    gapX: GAP.gapX,
    gapY: GAP.gapY,
    align: { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" },
  },
})

export type GridProps = React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> } & VariantProps<typeof gridVariants> &
  StyleProps & { as?: ElementTag }

export function Grid({ as: Tag = "div", columns, responsive, gap, gapX, gapY, align, className, ...props }: GridProps) {
  const [style, rest] = splitStyle(props)
  const Element = Tag as React.ElementType
  return <Element className={clsx(gridVariants({ columns, responsive, gap, gapX, gapY, align }), styleVariants(style), className)} {...rest} />
}
