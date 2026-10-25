import type { CSSProperties } from "react"
import { paletteColor } from "../../patterns/palette"
import "./editor.css"

/** Who speaks (to whom). `color` is the color a person gave the character (none: the plain muted name). */
export function SpeakerIdentity({ speaker, listener, listenerIsPerson: _listenerIsPerson = true, color }: { speaker: string | null; listener?: string | null; listenerIsPerson?: boolean; color?: string | null }) {
  const name = speaker?.trim() ?? ""
  const label = name || "화자 없음"
  const speakerColor = name && color ? paletteColor(color) : "var(--text-color-muted)"
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
      <span className="speaker-name truncate font-medium text-muted" style={{ "--speaker-color": speakerColor } as CSSProperties}>{label}</span>
      {Boolean(listener?.trim()) && (
        <>
          <span aria-hidden="true" className="text-subtle">→</span>
          <span className="truncate text-subtle">{listener!.trim()}</span>
        </>
      )}
    </span>
  )
}
