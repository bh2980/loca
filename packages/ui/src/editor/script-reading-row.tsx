import type { ReactNode } from "react"
import { SpeakerIdentity } from "./speaker-identity"
import { AiMark, StatusIcon, type StatusLike } from "../tokens/status"
import { cn } from "../lib/utils"

/** One continuous reading surface for source and translation, with the same speaker/status language as the editor. */
export function ScriptReadingRow({ speaker, listener, listenerIsPerson, status, statusBy, source, translation, selected = false, className }: {
  speaker: string | null
  listener?: string | null
  listenerIsPerson?: boolean
  status?: StatusLike
  statusBy?: "ai" | "human" | null
  source: ReactNode
  translation: ReactNode
  selected?: boolean
  className?: string
}) {
  return (
    <article className={cn("min-w-0 border-b border-border-subtle px-4 py-3 sm:px-6", selected && "bg-selection/60", className)}>
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
        <SpeakerIdentity speaker={speaker} listener={listener} listenerIsPerson={listenerIsPerson} />
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <StatusIcon status={status} />
          {status?.name ?? "상태 없음"}
          <AiMark by={statusBy} />
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <div className="min-w-0 border-border-subtle md:border-r md:pr-4 text-sm leading-relaxed text-foreground">
          {source}
        </div>
        <div className="min-w-0 text-sm leading-relaxed text-foreground">
          {translation}
        </div>
      </div>
    </article>
  )
}
