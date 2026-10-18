import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/** Candidate text with source metadata and its apply action. */
export function CandidateCard({ text, meta, action, current = false, className }: {
  text: ReactNode
  meta?: ReactNode
  action?: ReactNode
  current?: boolean
  className?: string
}) {
  return (
    <article className={cn("flex min-w-0 flex-col gap-2 rounded-lg bg-card p-3.5", current ? "border border-primary" : "border border-transparent", className)}>
      <div className="min-w-0 text-sm leading-5">{text}</div>
      {(meta || action) && <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><div className="min-w-0 flex-1 truncate">{meta}</div>{action}</div>}
    </article>
  )
}
