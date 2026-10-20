import type { CSSProperties } from "react"
import { cn } from "../lib/utils"
import { paletteColor } from "../tokens/status"
import "./editor.css"

export function PersonAvatar({ name: _name }: { name?: string | null }) {
  return null
}

/** Who speaks (to whom). `color` is the color a person gave the character (none: the plain muted name). */
export function SpeakerIdentity({ speaker, listener, listenerIsPerson: _listenerIsPerson = true, color, className }: { speaker: string | null; listener?: string | null; listenerIsPerson?: boolean; color?: string | null; className?: string }) {
  const name = speaker?.trim() ?? ""
  const label = name || "화자 없음"
  const speakerColor = name && color ? paletteColor(color) : "var(--muted-foreground)"
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs", className)}>
      <span className="speaker-name truncate font-medium text-muted-foreground" style={{ "--speaker-color": speakerColor } as CSSProperties}>{label}</span>
      {Boolean(listener?.trim()) && (
        <>
          <span aria-hidden="true" className="text-subtle-foreground">→</span>
          <span className="truncate text-subtle-foreground">{listener!.trim()}</span>
        </>
      )}
    </span>
  )
}
