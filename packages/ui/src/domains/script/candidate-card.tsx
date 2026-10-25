import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

/** Candidate text with source metadata and its apply action. */
export function CandidateCard({ text, source, meta, action, current = false }: {
  text: ReactNode
  source?: ReactNode
  meta?: ReactNode
  action?: ReactNode
  current?: boolean
}) {
  return (
    <article className={cn("flex min-w-0 flex-col gap-2 rounded-lg bg-surface p-3.5", current ? "border border-accent" : "border border-transparent")}>
      <div className="min-w-0 text-sm leading-5">{text}</div>
      {(source || meta || action) && <div className="flex min-w-0 items-center gap-2 text-xs text-muted">{source}{meta && <div className="min-w-0 flex-1 truncate">{meta}</div>}{action}</div>}
    </article>
  )
}
