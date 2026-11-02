import type * as React from "react"
import { PencilLine } from "lucide-react"
import { cn } from "../../lib/utils"
import { ExpandableRow } from "../../patterns/expandable-row"

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
        "group relative grid gap-3 border-b border-subtle px-4 py-3 last:border-b-0",
        editable && "cursor-pointer hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none",
        editable && editing && "bg-accent/5 shadow-[inset_2px_0_0_var(--border-color-accent)]",
        tint === "choice" && "bg-graph-choice/5",
        tint === "muted" && "bg-sunken",
        tint === "here" && "bg-accent/5 shadow-[inset_2px_0_0_var(--border-color-accent)]",
      )}
      {...props}
    >
      <span className="truncate pt-px text-xs text-muted">{who}</span>
      <div className="min-w-0 text-sm">{what}</div>
      {editable && <PencilLine className="absolute top-2.5 right-3 size-3.5 text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
    </li>
  )
}

/** What a pane shows of each line: both, or one of them alone. */
export type FlowShow = "both" | "source" | "translation"

/**
 * A line's text in a `FlowRow`. Both: the source small and quiet above, the translation (what is being worked on) in body text with a
 * rule at its left that binds it to the source. One alone is body text without the rule. A missing translation is said, in a dashed
 * box, so an empty line is not read past.
 */
export function FlowLine({ show, source, translation, clamp }: { show: FlowShow; source: React.ReactNode; translation?: React.ReactNode; /** At most two lines of each: a folded row. */ clamp?: boolean }) {
  const missing = translation === null || translation === undefined || translation === false || translation === ""
  return (
    <div className={cn("space-y-1.5", clamp && "[&>*]:line-clamp-2")}>
      {show !== "translation" && <div className={cn(show === "both" ? "text-xs text-muted" : "text-sm")}>{source}</div>}
      {show !== "source" &&
        (missing ? (
          <p className="inline-block rounded-sm border border-dashed border-default px-2 py-0.5 text-xs text-muted">번역 없음</p>
        ) : (
          <div className={cn("text-sm", show === "both" && "border-l-2 border-default pl-2")}>{translation}</div>
        ))}
    </div>
  )
}

/**
 * A line of a node as a folded row (the shared `ExpandableRow`): who and its text (`what`) in the same two columns as a `FlowRow`,
 * and the line's details under it once opened. `columns` is the parent's column style, as for `FlowRow`.
 */
export function FlowDisclosure({ who, what, columns, defaultOpen, children }: { who: React.ReactNode; what: React.ReactNode; columns: React.CSSProperties; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <div className="px-3">
      <ExpandableRow ruled defaultOpen={defaultOpen} summary={
        <span className="grid min-w-0 flex-1 items-start gap-3" style={columns}>
          <span className="truncate pt-px text-xs text-muted">{who}</span>
          <span className="min-w-0 text-sm">{what}</span>
        </span>
      }>
        {children}
      </ExpandableRow>
    </div>
  )
}

/** The draggable edge between two columns of a pane (`aria-orientation="vertical"`); the parent places it with `style.left`. */
export function ColumnResizeHandle(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div role="separator" aria-orientation="vertical" className="absolute top-0 bottom-0 z-10 w-2 cursor-col-resize hover:bg-line/60" {...props} />
}
