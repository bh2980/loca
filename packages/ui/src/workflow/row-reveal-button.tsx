import * as React from "react"
import { Button, type ButtonProps } from "../primitives/button"

const HOVER = {
  foreground: "text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100",
  destructive: "text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100",
} as const

/**
 * A quiet icon button at the end of a table row that shows only while the row is hovered or the button has focus (duplicate, delete).
 * `hover` is the color it takes under the pointer: foreground, or destructive for a delete.
 */
export const RowRevealButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, "variant" | "size"> & { hover?: keyof typeof HOVER }>(
  ({ hover = "foreground", className, ...props }, ref) => (
    <Button ref={ref} variant="ghost" size="icon" className={[HOVER[hover], className].filter(Boolean).join(" ")} {...props} />
  ),
)
RowRevealButton.displayName = "RowRevealButton"
