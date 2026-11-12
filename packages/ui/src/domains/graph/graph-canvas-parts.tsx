import type { ComponentProps } from "react"

/* The source graph's own pieces on the shared canvas surface (patterns/canvas-surface.tsx). */

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
