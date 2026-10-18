import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/** Stable two-language row with dedicated interaction and metadata areas. */
export function TranslationRow({ checkbox, speaker, status, source, translation, actions, meta, selected = false, compact = false, layout = "grid", className }: {
  checkbox?: ReactNode
  speaker?: ReactNode
  status?: ReactNode
  source: ReactNode
  translation: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  selected?: boolean
  compact?: boolean
  layout?: "grid" | "focus" | "review"
  className?: string
}) {
  if (layout === "focus") {
    return (
      <article className={cn("grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 px-3 py-6", selected && "bg-selection/60", className)}>
        <div className="row-span-2 flex justify-center pt-0.5">{checkbox}</div>
        <div className="mx-auto w-full max-w-3xl min-w-0">
          {(speaker || status || meta) && <div className="mb-3 flex min-h-4 items-center gap-2">{speaker}<span className="ml-auto flex items-center gap-2">{status}{meta}</span></div>}
          <div className="text-base leading-6">{source}</div>
          <div className="mt-6 border-t border-border-subtle pt-4 text-base leading-6">
            {translation}
            {actions && <div className="mt-3">{actions}</div>}
          </div>
        </div>
      </article>
    )
  }
  return (
    <article className={cn("grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 px-3", compact ? "py-2" : layout === "review" ? "py-2.5" : "py-3", selected && "bg-selection/60", className)}>
      <div className="row-span-2 flex justify-center pt-0.5">{checkbox}</div>
      <div className="min-w-0 border-r border-border-subtle pr-3.5">
        {speaker && <div className="mb-1 min-h-4">{speaker}</div>}
        <div className={cn("min-w-0", compact ? "text-sm leading-5" : "text-sm leading-relaxed")}>{source}</div>
      </div>
      <div className="min-w-0 pl-1.5">
        {(status || meta) && <div className="mb-1 flex min-h-4 items-center gap-2">{status}{meta}</div>}
        <div className={cn("min-w-0", compact ? "text-sm leading-5" : "text-sm leading-relaxed")}>{translation}</div>
        {actions && <div className="mt-2">{actions}</div>}
      </div>
    </article>
  )
}
