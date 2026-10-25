import type * as React from "react"
import { PencilLine } from "lucide-react"
import { cn } from "../lib/utils"

/**
 * One row of a dialogue-graph selection read like a script: who | what (the column widths are the parent's `style`). A row that opens
 * a line is `editable` (clickable, a pen on hover); `tint` colors a player's choice, a node without lines, or the node asked for.
 */
export function FlowRow({ who, what, editable, editing, tint, ...props }: Omit<React.ComponentProps<"li">, "className" | "children"> & {
  who: React.ReactNode
  what: React.ReactNode
  editable?: boolean
  /** The line open in the translation card. */
  editing?: boolean
  tint?: "choice" | "muted" | "here"
}) {
  return (
    <li
      className={cn(
        "group relative grid gap-3 px-4 py-2",
        editable && "cursor-pointer hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        editable && editing && "bg-primary/5 shadow-[inset_2px_0_0_var(--primary)]",
        tint === "choice" && "bg-choice/5",
        tint === "muted" && "bg-muted",
        tint === "here" && "bg-primary/5 shadow-[inset_2px_0_0_var(--primary)]",
      )}
      {...props}
    >
      <span className="truncate pt-px text-xs text-muted-foreground">{who}</span>
      <div className="min-w-0 text-sm">{what}</div>
      {editable && <PencilLine className="absolute top-2.5 right-3 size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
    </li>
  )
}

/** A choice or condition on the way into a node, as a small pill (a player's choice is tinted). */
export function WayChip({ choice, children }: { choice?: boolean; children: React.ReactNode }) {
  return <span className={cn("rounded-full border px-1.5", choice ? "border-choice/30 bg-choice/10 text-choice" : "bg-background")}>{children}</span>
}

/** The draggable edge between two columns of a pane (`aria-orientation="vertical"`); the parent places it with `style.left`. */
export function ColumnResizeHandle(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div role="separator" aria-orientation="vertical" className="absolute top-0 bottom-0 z-10 w-2 cursor-col-resize hover:bg-border/60" {...props} />
}
