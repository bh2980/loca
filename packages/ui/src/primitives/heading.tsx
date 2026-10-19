import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/**
 * The type hierarchy of panes and dialogs, one role per level, so nested information reads as nested:
 * 1. SectionHeading: a section of a pane or dialog (text-sm, semibold, foreground); `page` for a
 *    section of a full page such as the project home (text-base), one step above pane sections.
 * 2. GroupHeading: a group inside a section (text-xs, semibold, foreground).
 * 3. Row labels (PropertyRow, FieldRows): text-xs, regular, muted.
 * Content under them is text-sm foreground; counts, keys, times and evidence are text-xs muted.
 * Screens use these parts instead of styling h2/h3/h4/legend themselves (pnpm ui-rules).
 */
export function SectionHeading({ children, actions, className, page, as: Tag = "h2" }: { children: ReactNode; actions?: ReactNode; className?: string; page?: boolean; as?: "h1" | "h2" | "h3" | "legend" }) {
  const heading = <Tag className={cn("min-w-0 font-semibold text-foreground", page ? "text-base" : "text-sm", !actions && className)}>{children}</Tag>
  if (!actions) return heading
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-2", className)}>
      {heading}
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  )
}

export function GroupHeading({ children, actions, className, as: Tag = "h3" }: { children: ReactNode; actions?: ReactNode; className?: string; as?: "h3" | "h4" | "legend" }) {
  const heading = <Tag className={cn("min-w-0 text-xs font-semibold text-foreground", !actions && className)}>{children}</Tag>
  if (!actions) return heading
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-2", className)}>
      {heading}
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  )
}

/** A titled group inside a section: its heading, then its content (text-sm). */
export function Group({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 space-y-1.5 text-sm", className)}>
      <GroupHeading actions={actions}>{title}</GroupHeading>
      {children}
    </section>
  )
}

/** Rows of a label (level 3) and its controls or value, labels in one column (filters, settings rows in dialogs). */
export function FieldRows({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 text-sm", className)}>{children}</div>
}

export function FieldRow({ label, children, className }: { label: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("col-span-2 grid grid-cols-subgrid items-start", className)}>
      <div className="min-w-0 pt-0.5 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
