import type * as React from "react"
import { clsx } from "clsx"
import { Box, type BoxProps } from "./box"
import { Grid } from "./grid"
import { Inline } from "./stack"

type Common = { /** Which padding goes: the first item's top and the last item's bottom (`ends`, the default), or only the first's top (`start`). */ trim?: "ends" | "start"; /** Marks the row as a hover group: a `Button` with `reveal` shows only while the row is hovered or has focus. */ group?: boolean }

export type ListItemProps =
  | (Omit<BoxProps, "as" | "className"> & Common & { layout?: "block" })
  | (Omit<React.ComponentProps<typeof Inline>, "as" | "className"> & Common & { layout: "inline" })
  | (Omit<React.ComponentProps<typeof Grid>, "as" | "className"> & Common & { layout: "grid" })

/**
 * An item of a list whose rows are spaced by their own vertical padding: the first has no space above and the last none below, so the
 * list ends flush. `layout` is the item's own arrangement (a block by default, an inline row, or a grid).
 */
export function ListItem(props: ListItemProps) {
  const className = (trim: Common["trim"], group: boolean | undefined) =>
    clsx(trim === "start" ? "first:pt-0" : "first:pt-0 last:pb-0", group && "group")
  if (props.layout === "inline") {
    const { layout: _, trim, group, ...rest } = props
    return <Inline as="li" className={className(trim, group)} {...rest} />
  }
  if (props.layout === "grid") {
    const { layout: _, trim, group, ...rest } = props
    return <Grid as="li" className={className(trim, group)} {...rest} />
  }
  const { layout: _, trim, group, ...rest } = props
  return <Box as="li" className={className(trim, group)} {...rest} />
}
