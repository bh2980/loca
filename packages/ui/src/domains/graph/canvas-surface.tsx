import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from "react"
import { useDismissableLayerSurface } from "@radix-ui/react-dismissable-layer"
import { Box, type BoxProps } from "../../primitives/box"

/**
 * What a graph canvas is made of: the frame that holds it, the slots laid over it (a header, a floating toolbar), the found-node list under
 * its search box, and the elements of a graph drawn on a canvas 2D context (the page draws; the size is its `style`, as it follows the
 * measured area).
 */

/**
 * A ref that makes pressing a canvas close the open popover or menu. Panning and zooming (d3-zoom, React Flow) stop the mouse
 * press from spreading, and an open popover takes a press it does not hear the end of as one meant for something else, so it
 * would stay open. Every zoomable canvas takes it: CanvasSurface does, and a React Flow outside one passes it as its `ref`.
 */
export const useCanvasDismiss = (): Ref<HTMLDivElement> => useDismissableLayerSurface()

const setRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === "function") ref(value)
  else if (ref) (ref as { current: T | null }).current = value
}

/** Flex-shrink-safe frame for measured graph canvases and their floating controls. */
export function CanvasSurface({ grow = true, fill, ref, ...props }: Omit<ComponentProps<"div">, "className"> & { grow?: boolean; /** As wide and tall as its parent (a graph in a pane of its own). */ fill?: boolean }) {
  const dismiss = useCanvasDismiss()
  const both = useCallback((node: HTMLDivElement | null) => {
    setRef(dismiss, node)
    setRef(ref, node)
  }, [dismiss, ref])
  return (
    <div
      {...props}
      ref={both}
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
    <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-col items-start gap-2">
      {/* Only the controls take the pointer: the empty room between and beside them (a wrapped row) lets clicks through to the canvas. */}
      <div className="pointer-events-none flex w-fit max-w-full min-w-0 flex-wrap items-start gap-2 [&>*]:pointer-events-auto">{tools}</div>
      {details && <div className="pointer-events-none flex max-w-full flex-col items-start gap-2 [&>*]:pointer-events-auto">{details}</div>}
    </div>
  )
}

/**
 * A slot over a canvas that starts at its top-left corner, invisible; the screen measures its content, then places it with a
 * transform and shows it (a selection toolbar, a context anchor). `raised` puts it over the canvas's own overlays (the card being worked in).
 */
export function CanvasFloat({ raised, ...props }: Omit<BoxProps, "className"> & { raised?: boolean }) {
  return <Box className={raised ? "absolute top-0 left-0 z-40 opacity-0" : "absolute top-0 left-0 z-20 opacity-0"} {...props} />
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

/**
 * A layer over a canvas that draws one box: press, drag, let go (a press without a drag is a point, width and height 0).
 * The box is given in screen pixels (clientX/Y); Esc or onCancel ends it. While it is up the canvas does not pan: what the
 * pointer does here is draw (a frame, for instance).
 */
export function CanvasDrawLayer({ onDraw, onCancel, label }: { onDraw: (box: { x: number; y: number; width: number; height: number }) => void; onCancel: () => void; label?: string }) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null)
  const origin = useRef<DOMRect | null>(null)
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [onCancel])
  const box = start && end && { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
  const local = box && origin.current && { left: box.x - origin.current.left, top: box.y - origin.current.top, width: box.width, height: box.height }
  return (
    <div
      role="application"
      aria-label={label ?? "끌어서 그리기"}
      className="absolute inset-0 z-20 cursor-crosshair"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        origin.current = event.currentTarget.getBoundingClientRect()
        setStart({ x: event.clientX, y: event.clientY })
        setEnd({ x: event.clientX, y: event.clientY })
      }}
      onPointerMove={(event) => start && setEnd({ x: event.clientX, y: event.clientY })}
      onPointerUp={(event) => {
        if (!start) return
        const x = Math.min(start.x, event.clientX)
        const y = Math.min(start.y, event.clientY)
        const width = Math.abs(event.clientX - start.x)
        const height = Math.abs(event.clientY - start.y)
        setStart(null)
        setEnd(null)
        // A small wobble is a press, not a box.
        onDraw(width < 8 && height < 8 ? { x: start.x, y: start.y, width: 0, height: 0 } : { x, y, width, height })
      }}
    >
      {local && local.width + local.height > 0 && <div className="pointer-events-none absolute rounded-lg border-2 border-dashed border-accent bg-accent-soft/30" style={local} />}
    </div>
  )
}
