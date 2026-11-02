import type * as React from "react"
import { Check, CircleAlert, Wrench } from "lucide-react"
import { ExpandableRow } from "../../patterns/expandable-row"
import { Group } from "../../patterns/section"
import { Spinner } from "../../controls/spinner"

/** A card in the conversation for a change or result: a header (`ToolCardHeader`), a body and optional footer buttons. */
export function ToolCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border bg-page text-sm">{children}</div>
}

/**
 * A card's header: the title on one line (in a narrow panel the status wraps below instead of breaking the title), a `suffix` beside it, and
 * the status (`children`) pushed to the right.
 */
export function ToolCardHeader({ title, suffix, children }: { title: string; suffix?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-sunken px-3 py-2 text-sm font-semibold">
      <span className="flex min-w-0 items-center gap-2 whitespace-nowrap" title={title}>
        <Wrench className="size-3.5 shrink-0 text-muted" />
        <span className="truncate">{title}</span>
      </span>
      {suffix}
      <span className="ml-auto text-right text-xs font-normal">{children}</span>
    </div>
  )
}

/** A tool call that needs no card: one quiet line (state, name), opening to its raw input or output. */
export function ToolCallRow({ status, label, detail, output }: { status: "running" | "done" | "error"; label: string; detail?: React.ReactNode; output?: string }) {
  const title = (
    <span className="inline-flex min-w-0 items-center gap-1">
      {status === "error" ? <CircleAlert className="size-3.5 text-danger" /> : status === "done" ? <Check className="size-3.5" /> : <Spinner />}
      {label}
      {detail}
    </span>
  )
  // Nothing to open yet (still running): the line alone.
  if (!output) return <div className="text-2xs font-semibold text-muted">{title}</div>
  // Opens like every fold: open at first, and folding it folds every tool call's output from then on.
  return (
    <Group spaceY="tight" collapsible persistKey="chat.tool-call" title={title}>
      <pre className="max-h-48 overflow-auto rounded-md bg-sunken p-2 text-xs">{output}</pre>
    </Group>
  )
}

/** A line of source text with where it comes from; long text is clamped and opens in full (the shared `ExpandableRow`). */
export function SourceExcerpt({ heading, text, expandLabel }: { heading: string; text: string; expandLabel: string }) {
  return (
    <div className="min-w-0 rounded-md bg-sunken/50 px-1 py-1">
      <ExpandableRow label={expandLabel} summary={
        <span className="flex min-w-0 flex-col">
          <span className="text-xs text-subtle">{heading}</span>
          <span className="mt-0.5 line-clamp-2 break-words text-xs text-default group-data-[state=open]:hidden" title={text}>{text}</span>
        </span>
      }>
        <p className="whitespace-pre-wrap break-words text-xs text-default">{text}</p>
      </ExpandableRow>
    </div>
  )
}

/** A tool result that could not be made, as a small card in place of the result. */
export function ToolErrorCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-page px-3 py-2 text-xs" role="status">
      {children}
    </div>
  )
}

/** Where the server summarized the conversation's start: a line that opens to the summary the model reads in its place. */
export function CompactionNotice({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div role="status">
      <ExpandableRow size="inline" open={open} onOpenChange={onToggle} summary={title}>
        <p className="rounded-md bg-sunken px-3 py-2 text-xs whitespace-pre-wrap text-muted">{children}</p>
      </ExpandableRow>
    </div>
  )
}
