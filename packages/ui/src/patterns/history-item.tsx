import type * as React from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible"
import { cn } from "../lib/utils"

/**
 * A history as a timeline, newest first, in days ("오늘 · 11월 1일"): each entry has who did it (a mark on the
 * timeline), what it was, its time (always shown), the text it left and what changed, and its actions under it.
 */
export function HistoryDay({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium text-subtle">{label}</h4>
      <ol>{children}</ol>
    </section>
  )
}

const ACTOR = {
  workflow: "bg-success/15 text-success",
  person: "bg-accent-soft text-on-accent-soft",
  ai: "bg-ai-soft text-ai",
  neutral: "bg-neutral text-muted",
} as const

export type HistoryActor = keyof typeof ACTOR

/**
 * One entry of a history. `mark` is one letter on the timeline (W for a workflow, a person's initial, AI), `title` who
 * did it (bold) and `meta` what it was (· 수정 단계), `badges` beside them (현재 번역), `time` at the right end, always
 * shown. `children` (the text, its 이전/이후, a warning) and `actions` (되돌리기, 실행 기록 보기) sit under the head.
 */
export function HistoryEntry({ actor, mark, title, meta, badges, time, actions, muted, children }: {
  actor: HistoryActor
  mark: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  badges?: React.ReactNode
  time?: React.ReactNode
  actions?: React.ReactNode
  /** A text that never was the line's (a declined suggestion). */
  muted?: boolean
  children?: React.ReactNode
}) {
  return (
    <li className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5 pb-4 last:pb-1 before:absolute before:top-6 before:bottom-1 before:left-2.5 before:w-px before:bg-line last:before:hidden">
      <span aria-hidden="true" className={cn("mt-px flex size-5 items-center justify-center rounded-full text-2xs font-bold", ACTOR[actor])}>{mark}</span>
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate text-sm">
            <span className="font-semibold text-default">{title}</span>
            {meta && <span className="text-xs text-muted"> · {meta}</span>}
          </span>
          {badges && <span className="flex shrink-0 items-center gap-1 self-center">{badges}</span>}
          {time && <span className="ml-auto shrink-0 text-xs text-subtle tabular-nums">{time}</span>}
        </div>
        {children && <div className={cn("space-y-1.5 text-sm break-words whitespace-pre-line", muted ? "text-muted" : "text-default")}>{children}</div>}
        {actions && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">{actions}</div>}
      </div>
    </li>
  )
}

/** What an entry changed: the text before (removed words struck) and after (added words marked), labelled. */
export function HistoryDiff({ before, after }: { before: React.ReactNode; after: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-l-2 border-subtle pl-2.5 text-xs">
      <dt className="text-subtle">이전</dt>
      <dd className="min-w-0 break-words whitespace-pre-line text-muted">{before}</dd>
      <dt className="text-subtle">이후</dt>
      <dd className="min-w-0 break-words whitespace-pre-line text-default">{after}</dd>
    </dl>
  )
}

/** The entries that left the text as it was (a check that changed nothing, a failure), folded into one box under the timeline. */
export function HistoryFolded({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Collapsible className="group/folded rounded-md border border-default">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-default outline-none focus-visible:ring-2 focus-visible:ring-focus/40">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="flex items-center gap-1 font-normal text-muted">
          <span className="group-data-[state=open]/folded:hidden">펼치기</span>
          <span className="hidden group-data-[state=open]/folded:inline">접기</span>
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]/folded:rotate-180" aria-hidden="true" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y divide-subtle border-t border-default">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** One row of HistoryFolded: what ran (bold) and on what, its state and time at the right. */
export function HistoryFoldedRow({ title, meta, end }: { title: React.ReactNode; meta?: React.ReactNode; end?: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-default">{title}</span>
        {meta && <span className="text-muted"> · {meta}</span>}
      </span>
      {end && <span className="shrink-0 tabular-nums">{end}</span>}
    </li>
  )
}
