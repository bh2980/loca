import type * as React from "react"
import { ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible"

/**
 * The entries of a history (a line's texts and runs), newest first: a list with hairlines between them.
 */
export function HistoryList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-subtle">{children}</ul>
}

/**
 * One entry of a history. A head line (`title`, `badges`, `time` at the right) and, under it, a two-line `preview`; with
 * `children` the head opens the entry (the preview gives way to the whole text and what changed). `action` (되돌리기) takes the
 * time's place while the entry is hovered, focused or open, so it has no room of its own (as a menu row's count and action).
 */
export function HistoryItem({ title, badges, time, preview, action, children }: {
  title: React.ReactNode
  badges?: React.ReactNode
  time?: React.ReactNode
  preview?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  const head = (
    <>
      <span className="min-w-0 truncate text-sm font-medium text-default">{title}</span>
      {badges && <span className="flex shrink-0 items-center gap-1">{badges}</span>}
    </>
  )
  // The time and the action share one cell at the right end: the action shows over the hidden time.
  const end = (time || action) && (
    <span className="ml-auto grid shrink-0 items-center justify-items-end *:col-start-1 *:row-start-1">
      {time && (
        <span className={action ? "text-xs text-subtle tabular-nums group-hover/history:invisible group-focus-within/history:invisible group-data-[state=open]/history:invisible" : "text-xs text-subtle tabular-nums"}>
          {time}
        </span>
      )}
      {action && (
        <span className="invisible flex items-center group-hover/history:visible group-focus-within/history:visible group-data-[state=open]/history:visible">{action}</span>
      )}
    </span>
  )
  if (!children)
    return (
      <li className="group/history py-2">
        <div className="flex min-w-0 items-center gap-2 pl-5.5">
          {head}
          {end}
        </div>
        {preview && <div className="mt-0.5 line-clamp-2 pl-5.5 text-xs text-muted">{preview}</div>}
      </li>
    )
  return (
    <Collapsible asChild>
      <li className="group/history py-2">
        <div className="flex min-w-0 items-center gap-2">
          <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-focus/40">
            <ChevronRight className="size-3.5 shrink-0 text-muted transition-transform group-data-[state=open]/history:rotate-90" aria-hidden="true" />
            {head}
          </CollapsibleTrigger>
          {end}
        </div>
        {preview && <div className="mt-0.5 line-clamp-2 pl-5.5 text-sm break-words whitespace-pre-line text-muted group-data-[state=open]/history:hidden">{preview}</div>}
        <CollapsibleContent className="mt-1 space-y-2 pl-5.5 text-sm">{children}</CollapsibleContent>
      </li>
    </Collapsible>
  )
}
