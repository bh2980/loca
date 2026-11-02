import { ChevronDown } from "lucide-react"
import type * as React from "react"
import { Button } from "../controls/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible"
import { cn } from "../lib/utils"

/**
 * The second folding pattern, beside `Section collapsible` / `Group collapsible` (parts of a pane, open at first): one item of a
 * list that opens its details under it — a request's part, a run step, a line of a node, a tree branch, a call's input and output.
 * Rows start closed (a list of open rows is no list), and what is inside is made only when opened, so a row can load on open.
 * The chevron is the folding sections' one: before the summary, pointing down when open.
 * - `toggle="row"` (default): the whole summary is the button. `toggle="chevron"`: only the chevron is, for a summary that holds its
 *   own link or buttons (a tree branch's link, a row with 되돌리기).
 * - `size="row"`: a full-width row, text-sm, `meta` (sizes, times) at its end; `ruled` puts a hairline between rows.
 *   `size="inline"`: a small muted line inside other content (a call's 입출력, a summarized conversation).
 */
export function ExpandableRow({ summary, meta, label, open, defaultOpen, onOpenChange, toggle = "row", size = "row", ruled, disabled, children }: {
  summary: React.ReactNode
  meta?: React.ReactNode
  /** The chevron button's name when `toggle="chevron"` (the summary is not inside it). */
  label?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  toggle?: "row" | "chevron"
  size?: "row" | "inline"
  ruled?: boolean
  disabled?: boolean
  children?: React.ReactNode
}) {
  const chevron = <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted transition-transform group-data-[state=closed]:-rotate-90" />
  const inline = size === "inline"
  return (
    <Collapsible open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} disabled={disabled} className={cn("min-w-0", ruled && "border-b border-subtle last:border-b-0")}>
      {toggle === "chevron" ? (
        <div className={cn("flex min-w-0 items-center gap-1", inline ? "text-xs text-muted" : "text-sm")}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" className="group" aria-label={label} title={label}>{chevron}</Button>
          </CollapsibleTrigger>
          <div className="flex min-w-0 flex-1 items-center gap-2">{summary}</div>
          {meta != null && <div className="flex shrink-0 items-center gap-1 text-xs text-muted tabular-nums">{meta}</div>}
        </div>
      ) : (
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "group h-auto min-w-0 justify-start text-left font-normal whitespace-normal",
              inline ? "-ml-1 gap-1 px-1 py-0.5 text-xs text-muted" : "w-full items-start gap-1.5 rounded-sm px-1 py-2 text-sm text-default hover:bg-hover/60",
            )}
          >
            <span className={cn("flex shrink-0 items-center", !inline && "h-5")}>{chevron}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2">{summary}</span>
            {meta != null && <span className="ml-auto shrink-0 pl-2 text-xs text-muted tabular-nums">{meta}</span>}
          </Button>
        </CollapsibleTrigger>
      )}
      {/* The content starts under the summary's text, past the chevron. */}
      <CollapsibleContent className={cn("min-w-0", inline ? "mt-1" : toggle === "chevron" ? "pb-3 pl-7" : "pb-3 pl-6")}>{children}</CollapsibleContent>
    </Collapsible>
  )
}
