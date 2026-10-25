import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

/** The two-language row of a line, with dedicated interaction and metadata areas. `selected`: the open line; otherwise it is clickable. `flagged`: a find match. */
export function ScriptTranslationRow({ checkbox, speaker, status, source, translation, actions, meta, selected = false, flagged = false, compact = false, layout = "grid" }: {
  checkbox?: ReactNode
  speaker?: ReactNode
  status?: ReactNode
  source: ReactNode
  translation: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  selected?: boolean
  compact?: boolean
  /** A find match: tinted while the line is not the open one. */
  flagged?: boolean
  layout?: "grid" | "focus" | "review"
}) {
  const state = selected ? "bg-selected" : cn("cursor-pointer hover:bg-hover", flagged && "bg-warning/5")
  if (layout === "focus") {
    return (
      <article className={cn("grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 px-3 py-6", state)}>
        <div className="row-span-2 flex justify-center pt-0.5">{checkbox}</div>
        <div className="mx-auto w-full max-w-3xl min-w-0">
          {(speaker || status || meta) && <div className="mb-3 flex min-h-4 items-center gap-2">{speaker}<span className="ml-auto flex items-center gap-2">{status}{meta}</span></div>}
          <div className="text-base leading-6">{source}</div>
          <div className="mt-6 border-t border-subtle pt-4 text-base leading-6">
            {translation}
            {actions && <div className="mt-3">{actions}</div>}
          </div>
        </div>
      </article>
    )
  }
  return (
    <article className={cn("grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 px-3", compact || layout === "review" ? "py-2" : "py-3", state)}>
      <div className="row-span-2 flex justify-center pt-0.5">{checkbox}</div>
      <div className="min-w-0 border-r border-subtle pr-3">
        {speaker && <div className="mb-1 min-h-4">{speaker}</div>}
        <div className={cn("min-w-0", compact ? "text-sm leading-5" : "text-sm leading-relaxed")}>{source}</div>
      </div>
      <div className="min-w-0 pl-2">
        {(status || meta) && <div className="mb-1 flex min-h-4 items-center gap-2">{status}{meta && <span className="ml-auto flex items-center gap-1">{meta}</span>}</div>}
        <div className={cn("min-w-0", compact ? "text-sm leading-5" : "text-sm leading-relaxed")}>{translation}</div>
        {actions && <div className="mt-2">{actions}</div>}
      </div>
    </article>
  )
}
