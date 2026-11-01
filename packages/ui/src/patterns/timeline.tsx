import type * as React from "react"
import { cn } from "../lib/utils"

/**
 * Something that holds from a starting point and changes at later points, read top to bottom in story order:
 * `TimelineStart` is what holds from the beginning (a card with its title, value, why and a footer), then a `Timeline`
 * rail whose `TimelinePoint`s are the changes only. A point is a card on the rail: where it starts and in which
 * scene (`title`, `meta`), its state (`status`), what changed (`TimelineFields`: before → after, changed fields only),
 * why, its lines (`TimelineQuotes`), and a footer of counts at the start and buttons at the end (never wrapping).
 * A point waiting for a decision (`candidate`) has a dashed mark; one being edited (`active`) is outlined in the accent.
 */
export function Timeline({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <ol aria-label={label} className="relative">
      {children}
    </ol>
  )
}

const MARK = {
  confirmed: "border-accent bg-surface",
  candidate: "border-dashed border-warning bg-surface",
  add: "border-dashed border-default bg-surface",
} as const

export type TimelineMark = keyof typeof MARK

/** The card both a start and a point use: a head row, the body, a footer of counts and buttons. */
function PointCard({ title, meta, status, children, counts, actions, active }: {
  title: React.ReactNode
  meta?: React.ReactNode
  status?: React.ReactNode
  children?: React.ReactNode
  counts?: React.ReactNode
  actions?: React.ReactNode
  active?: boolean
}) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-surface", active ? "border-accent ring-1 ring-accent" : "border-default")}>
      <div className="flex min-w-0 items-center gap-2 px-3 pt-2.5">
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="font-semibold text-default">{title}</span>
          {meta && <span className="text-muted"> · {meta}</span>}
        </span>
        {status && <span className="flex shrink-0 items-center gap-1">{status}</span>}
      </div>
      {children && <div className="min-w-0 space-y-2 px-3 pt-2 pb-2.5 text-sm break-words text-default">{children}</div>}
      {(counts || actions) && (
        <div className="flex min-w-0 items-center gap-2 border-t border-subtle px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted tabular-nums">{counts}</span>
          {actions && <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">{actions}</span>}
        </div>
      )}
    </div>
  )
}

/** What holds from the beginning, above the rail: `title` ("기본 말투 · 처음부터"), the value and why as children, `counts` and `actions` in its footer. */
export function TimelineStart(props: React.ComponentProps<typeof PointCard>) {
  return <PointCard {...props} />
}

/**
 * One change on the rail. `mark` is the dot: `confirmed`, `candidate` (dashed, waiting for a decision) or `add` (the
 * form of a change not made yet). Without `title` the point is only its children (a form, a button).
 */
export function TimelinePoint({ mark = "confirmed", title, meta, status, children, counts, actions, active }: Partial<React.ComponentProps<typeof PointCard>> & { mark?: TimelineMark }) {
  return (
    <li className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 pb-3 last:pb-0 before:absolute before:top-5 before:bottom-0 before:left-[7px] before:w-px before:bg-line last:before:hidden">
      <span aria-hidden="true" className={cn("mt-3 size-3.5 rounded-full border-2", MARK[mark])} />
      {title !== undefined ? (
        <PointCard title={title} meta={meta} status={status} counts={counts} actions={actions} active={active}>
          {children}
        </PointCard>
      ) : (
        <div className="min-w-0 pt-1.5">{children}</div>
      )}
    </li>
  )
}

/** What a point changed, one row per changed field: its label, the value before (struck, muted) → the value after. */
export function TimelineFields({ items }: { items: { label: React.ReactNode; before?: React.ReactNode; after: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-xs leading-5 text-subtle">{item.label}</dt>
          <dd className="min-w-0 break-words">
            {item.before != null && item.before !== "" && (
              <>
                <span className="text-muted line-through">{item.before}</span>
                <span aria-label="에서" className="px-1 text-subtle">→</span>
              </>
            )}
            <span className="font-medium text-default">{item.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Why a point is there: one short paragraph, muted. */
export function TimelineNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm whitespace-pre-line text-muted">{children}</p>
}

/** A point's lines (a few cited ones): each its key and its text, under a faint rule. */
export function TimelineQuotes({ items }: { items: { id: string; label: React.ReactNode; text: React.ReactNode; sub?: React.ReactNode }[] }) {
  return (
    <ul className="space-y-1.5 border-t border-subtle pt-2">
      {items.map((item) => (
        <li key={item.id} className="min-w-0 text-xs">
          <span className="font-mono text-subtle">{item.label}</span>
          <span className="block min-w-0 truncate text-default">{item.text}</span>
          {item.sub && <span className="block min-w-0 truncate text-muted">{item.sub}</span>}
        </li>
      ))}
    </ul>
  )
}
