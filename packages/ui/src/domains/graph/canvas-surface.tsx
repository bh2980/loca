import type { ComponentProps, ReactNode } from "react"
import { Box, type BoxProps } from "../../primitives/box"

/**
 * What a graph canvas is made of: the frame that holds it, the slots laid over it (a header, a floating toolbar), the found-node list under
 * its search box, and the elements of a graph drawn on a canvas 2D context (the page draws; the size is its `style`, as it follows the
 * measured area).
 */

/** Flex-shrink-safe frame for measured graph canvases and their floating controls. */
export function CanvasSurface({ grow = true, fill, ...props }: Omit<ComponentProps<"div">, "className"> & { grow?: boolean; /** As wide and tall as its parent (a graph in a pane of its own). */ fill?: boolean }) {
  return (
    <div
      {...props}
      className={
        "@container/canvas relative min-h-0 min-w-0 overflow-hidden bg-graph-canvas bg-[radial-gradient(var(--fill-graph-grid)_1px,transparent_1px)] [background-size:20px_20px] " +
        (grow ? "flex-1" : "flex-none") + (fill ? " h-full w-full" : "")
      }
    />
  )
}

/** Shared, stacked header region for canvas search, filters, and status details. */
export function CanvasOverlay({ tools, details }: { tools: ReactNode; details?: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col items-start gap-1.5">
      <div className="flex w-fit max-w-full min-w-0 flex-wrap items-start gap-1.5 pointer-events-auto">{tools}</div>
      {details && <div className="flex max-w-full flex-col items-start gap-1.5 pointer-events-auto">{details}</div>}
    </div>
  )
}

/**
 * A slot over a canvas that starts at its top-left corner, invisible; the screen measures its content, then places it with a
 * transform and shows it (a selection toolbar, a context anchor).
 */
export function CanvasFloat(props: Omit<BoxProps, "className">) {
  return <Box className="absolute top-0 left-0 z-20 opacity-0" {...props} />
}

/** The list of nodes found by the canvas's search box, dropping down under it. */
export function FoundNodeList(props: Omit<ComponentProps<"ul">, "className">) {
  return <ul className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-default bg-overlay/95 p-1 text-sm shadow-md backdrop-blur-md" {...props} />
}

/** The drawing surface: grabs to pan, takes keys (`tabIndex`), shows a focus ring. */
export function GraphCanvasElement(props: Omit<ComponentProps<"canvas">, "className">) {
  return <canvas className="block cursor-grab touch-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-focus" {...props} />
}

/** The rubber band drawn while dragging a selection (the page gives its position and size as `style`). */
export function SelectionRect(props: Omit<ComponentProps<"div">, "className">) {
  return <div aria-hidden className="pointer-events-none absolute rounded-sm border border-accent bg-accent/10" {...props} />
}

/** The overview map, floating at the canvas's lower left in its frame; a click on it (the canvas, which takes `ref` and the rest) moves the view there. */
export function GraphMinimap(props: Omit<ComponentProps<"canvas">, "className">) {
  return (
    <div className="absolute bottom-3 left-3 rounded-md border bg-page/90 shadow-sm">
      <canvas className="block cursor-pointer rounded-md" {...props} />
    </div>
  )
}
