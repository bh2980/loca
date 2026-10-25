import type * as React from "react"
import { Check, ChevronRight, CircleAlert, Wrench } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { Button } from "../primitives/button"
import { Spinner } from "../primitives/spinner"
import { cn } from "../lib/utils"

/** A card in the conversation for a change or result: a header (`ToolCardHeader`), a body and optional footer buttons. */
export function ToolCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border bg-background text-sm">{children}</div>
}

/**
 * A card's header: the title on one line (in a narrow panel the status wraps below instead of breaking the title), a `suffix` beside it, and
 * the status (`children`) pushed to the right.
 */
export function ToolCardHeader({ title, suffix, children }: { title: string; suffix?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted px-3 py-1.5 text-sm font-semibold">
      <span className="flex min-w-0 items-center gap-2 whitespace-nowrap" title={title}>
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{title}</span>
      </span>
      {suffix}
      <span className="ml-auto text-right text-xs font-normal">{children}</span>
    </div>
  )
}

/** A tool call that needs no card: one quiet line (state, name), opening to its raw input or output. */
export function ToolCallRow({ status, label, detail, output, defaultOpen }: { status: "running" | "done" | "error"; label: string; detail?: React.ReactNode; output?: string; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        {status === "error" ? <CircleAlert className="size-3.5 text-destructive" /> : status === "done" ? <Check className="size-3.5" /> : <Spinner className="size-3.5" />}
        {label}
        {detail}
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{output}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A line of source text with where it comes from; long text is clamped and opens in full. */
export function SourceExcerpt({ heading, text, expandLabel }: { heading: string; text: string; expandLabel: string }) {
  return (
    <Collapsible className="min-w-0 rounded-md bg-muted/50 px-2 py-1.5">
      <CollapsibleTrigger className="group flex w-full min-w-0 flex-col items-start text-left">
        <span className="text-subtle-foreground">{heading}</span>
        <span className="mt-0.5 line-clamp-2 break-words text-foreground" title={text}>{text}</span>
        <span className="mt-1 text-subtle-foreground">{expandLabel} <ChevronRight className="inline size-3 transition-transform group-data-[state=open]:rotate-90" /></span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-2 whitespace-pre-wrap break-words border-t border-border-subtle pt-2 text-foreground">{text}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** An error in the conversation's flow (the request failed), in the panel. */
export function ErrorNotice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{children}</p>
}

/** A tool result that could not be made, as a small card in place of the result. */
export function ToolErrorCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs" role="status">
      {children}
    </div>
  )
}

/** Where the server summarized the conversation's start: a line that opens to the summary the model reads in its place. */
export function CompactionNotice({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground" role="status">
      <Button variant="ghost" size="row" className="gap-1.5 px-0 text-xs" onClick={onToggle} aria-expanded={open}>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {title}
      </Button>
      {open && <p className="mt-1 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">{children}</p>}
    </div>
  )
}
