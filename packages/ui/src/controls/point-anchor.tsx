import * as React from "react"

export interface ScreenPoint {
  x: number
  y: number
}

/**
 * An invisible mark at a point of the screen for a menu or popover to stand by: what opens where the pointer was (a
 * right-click, a place on a canvas) has no element of its own to open from.
 */
export const PointAnchor = React.forwardRef<HTMLSpanElement, { at: ScreenPoint } & Omit<React.ComponentProps<"span">, "className" | "style">>(function PointAnchor({ at, ...props }, ref) {
  return <span ref={ref} aria-hidden style={{ position: "fixed", left: at.x, top: at.y, width: 1, height: 1, pointerEvents: "none" }} {...props} />
})
