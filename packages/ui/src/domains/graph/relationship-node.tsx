import * as React from "react"
import { cn } from "../../lib/utils"

/** A person in the relationship graph: a pill with the name; the main people are outlined heavier, the minor ones dashed. */
export function PersonNodeFrame({ role, active, dim, ...props }: Omit<React.ComponentProps<"div">, "className"> & {
  role?: string | null
  /** Selected, or the person a context menu acts on. */
  active?: boolean
  dim?: boolean
}) {
  return (
    <div
      className={cn(
        "group/person flex items-center justify-center rounded-md border border-default bg-page px-3 text-xs font-medium shadow-none transition-opacity",
        role === "main" && "border-2 border-strong/70 font-semibold",
        role === "minor" && "border-dashed text-muted",
        active && "border-accent ring-1 ring-accent/40",
        dim && "opacity-30",
      )}
      {...props}
    />
  )
}

/** The label of a relationship line, laid over the graph at the line's middle (the page gives `style.transform`). One button per relationship. */
export function RelationLabelFrame({ active, dim, ...props }: Omit<React.ComponentProps<"div">, "className"> & { active?: boolean; dim?: boolean }) {
  return <div className={cn("nodrag nopan absolute flex flex-col rounded border bg-page text-xs shadow-xs", active && "border-accent", dim && "opacity-30")} {...props} />
}
