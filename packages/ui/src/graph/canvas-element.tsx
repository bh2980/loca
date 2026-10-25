import * as React from "react"
import { cn } from "../lib/utils"

/**
 * The pieces of a graph drawn on a canvas 2D context (the page draws; these are the elements around the drawing). The size is the page's
 * `style`, because it follows the measured area.
 */

/** The drawing surface: grabs to pan, takes keys (`tabIndex`), shows a focus ring. */
export const GraphCanvasElement = React.forwardRef<HTMLCanvasElement, Omit<React.ComponentProps<"canvas">, "className">>((props, ref) => (
  <canvas ref={ref} className="block cursor-grab touch-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring" {...props} />
))
GraphCanvasElement.displayName = "GraphCanvasElement"

/** The rubber band drawn while dragging a selection (the page gives its position and size as `style`). */
export function SelectionRect(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div aria-hidden className="pointer-events-none absolute rounded-sm border border-primary bg-primary/10" {...props} />
}

/** The overview map's frame, floating at the canvas's lower left. */
export function MinimapFrame(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div className="absolute bottom-3 left-3 rounded-md border bg-background/90 shadow-sm" {...props} />
}

/** The overview map itself: a click moves the view there. */
export const MinimapCanvas = React.forwardRef<HTMLCanvasElement, Omit<React.ComponentProps<"canvas">, "className">>((props, ref) => (
  <canvas ref={ref} className={cn("block cursor-pointer rounded-md")} {...props} />
))
MinimapCanvas.displayName = "MinimapCanvas"
