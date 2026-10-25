import type { ReactNode } from "react"
import { SpeakerIdentity } from "./speaker-identity"
import { AiMark, StatusIcon, type StatusLike } from "../../patterns/status"
import { cn } from "../../lib/utils"

/** One continuous reading surface for source and translation, with the same speaker/status language as the editor. */
export function ScriptReadingRow({ speaker, speakerColor, listener, listenerIsPerson, status, statusBy, source, translation, selected = false }: {
  speaker: string | null
  /** The color a person gave the speaker (none: muted). */
  speakerColor?: string | null
  listener?: string | null
  listenerIsPerson?: boolean
  status?: StatusLike
  statusBy?: "ai" | "human" | null
  source: ReactNode
  translation: ReactNode
  selected?: boolean
}) {
  return (
    <article className={cn("min-w-0 border-b border-subtle px-4 py-3 sm:px-6", selected && "bg-selected/60")}>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <SpeakerIdentity speaker={speaker} color={speakerColor} listener={listener} listenerIsPerson={listenerIsPerson} />
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
          <StatusIcon status={status} />
          {status?.name ?? "상태 없음"}
          <AiMark by={statusBy} />
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <div className="min-w-0 border-subtle md:border-r md:pr-4 text-sm leading-relaxed text-default">
          {source}
        </div>
        <div className="min-w-0 text-sm leading-relaxed text-default">
          {translation}
        </div>
      </div>
    </article>
  )
}
