import type * as React from "react"
import { clsx } from "clsx"
import { Check, ChevronRight, CircleAlert, Pencil, Play, Trash2, Wrench } from "lucide-react"
import { ExpandableRow } from "../../patterns/expandable-row"
import { Group } from "../../patterns/section"
import { Spinner } from "../../controls/spinner"

/** A card in the conversation for a change or result: a header (`ToolCardHeader`), a body and optional footer buttons. */
export function ToolCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border bg-page text-sm">{children}</div>
}

/**
 * A card's header, one line: the title (in a narrow panel the rest wraps below instead of breaking it), an optional `summary`, a
 * `suffix` beside it, the status (`children`) and the card's buttons (`actions`) at the right.
 *
 * Given `onOpenChange`, the card folds: a chevron leads the title and the title opens and closes it (`open`); `expandable={false}`
 * keeps the line without the chevron (nothing more to show). Such a card says its risk by the title's color (delete) or a 실행 badge
 * (run), never with an icon; a card that does not fold keeps its kind's icon.
 */
export function ToolCardHeader({ title, suffix, summary, tone, children, actions, open, onOpenChange, expandable = true }: {
  title: string
  suffix?: React.ReactNode
  summary?: React.ReactNode
  tone?: "change" | "run" | "delete"
  children?: React.ReactNode
  actions?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  expandable?: boolean
}) {
  const folds = Boolean(onOpenChange)
  const icon =
    tone === "delete" ? <Trash2 className="size-3.5 shrink-0 text-danger" /> :
    tone === "run" ? <Play className="size-3.5 shrink-0 text-muted" /> :
    tone === "change" ? <Pencil className="size-3.5 shrink-0 text-muted" /> :
    <Wrench className="size-3.5 shrink-0 text-muted" />
  const name = <span className={clsx("truncate", folds && tone === "delete" && "text-danger")}>{title}</span>
  const heading = folds ? (
    expandable ? (
      <button
        type="button"
        className="-mx-1 flex min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1 whitespace-nowrap outline-none focus-visible:ring-[2px] focus-visible:ring-focus/40"
        aria-expanded={open}
        title={title}
        onClick={() => onOpenChange!(!open)}
      >
        <ChevronRight className={clsx("size-3.5 shrink-0 text-muted transition-transform", open && "rotate-90")} aria-hidden />
        {name}
      </button>
    ) : (
      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap" title={title}>{name}</span>
    )
  ) : (
    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap" title={title}>
      {icon}
      {name}
    </span>
  )
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-sunken px-3 text-sm font-semibold", folds ? "py-1.5" : "py-2", (!folds || open) && "border-b")}>
      {heading}
      {folds && tone === "run" ? <span className="rounded-sm bg-page px-1 text-2xs font-medium text-muted">실행</span> : null}
      {summary ? <span className="min-w-0 truncate text-xs font-normal text-muted">{summary}</span> : null}
      {suffix}
      <span className="ml-auto flex items-center gap-2 text-right text-xs font-normal">
        {children}
        {actions ? <span className="flex items-center gap-1">{actions}</span> : null}
      </span>
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
