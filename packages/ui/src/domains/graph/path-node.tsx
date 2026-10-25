import * as React from "react"
import { Button } from "../../controls/button"
import { cn } from "../../lib/utils"

/**
 * The boxes of the path graph's nodes. The graph library drives them (`nodrag` keeps a click from dragging, `nopan` from panning), and
 * the page gives each its measured size as `style`.
 */

/** A node that stands for hidden lines (`…`, `번역함 · n줄`): a dashed, quiet button filling its slot. `round` is the pill of `…`. */
export function PathNodeButton({ round, ...props }: Omit<React.ComponentProps<typeof Button>, "variant" | "className"> & { round?: boolean }) {
  return (
    <Button
      variant="outline"
      className={cn("nodrag h-full w-full border-dashed font-normal text-muted", round ? "rounded-full bg-page/60" : "bg-sunken")}
      {...props}
    />
  )
}

/** A choice or parallel fork: its pill on top, ringed when picked. */
export function ForkNodeFrame({ selected, ...props }: Omit<React.ComponentProps<"div">, "className"> & { selected?: boolean }) {
  return <div className={cn("flex flex-col items-center gap-1", selected && "ring-2 ring-accent/30")} {...props} />
}

/** A line, choice or section of the path: a card; `here` marks the line being translated with an inset bar, `selected` outlines it. */
export function PathNodeCard({ selected, here, ...props }: Omit<React.ComponentProps<"div">, "className"> & { selected?: boolean; here?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border bg-page px-3 py-2 text-sm shadow-xs",
        here && "shadow-[inset_3px_0_0_var(--border-color-accent)]",
        selected && "border-accent ring-2 ring-accent/30",
      )}
      {...props}
    />
  )
}

/** The label of an edge, laid over the graph where the layout left room for it (the page gives `style.transform` and `width`). */
export function PathEdgeLabel(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div className="nodrag nopan pointer-events-none absolute flex items-center gap-1 rounded-sm bg-page px-1 text-xs text-muted" {...props} />
}
