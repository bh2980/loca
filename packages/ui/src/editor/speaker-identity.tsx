import type { CSSProperties } from "react"
import { cn } from "../lib/utils"
import "./editor.css"

const SPEAKER_HUES = [2, 3, 5, 6, 7, 8, 9, 10, 11, 12]

function speakerHue(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return SPEAKER_HUES[hash % SPEAKER_HUES.length]
}

export function PersonAvatar({ name: _name }: { name?: string | null }) {
  return null
}

export function SpeakerIdentity({ speaker, listener, listenerIsPerson: _listenerIsPerson = true, className }: { speaker: string | null; listener?: string | null; listenerIsPerson?: boolean; className?: string }) {
  const name = speaker?.trim() ?? ""
  const label = name || "화자 없음"
  const color = name ? `var(--hue-${speakerHue(name)})` : "var(--muted-foreground)"
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs", className)}>
      <span className="speaker-name truncate font-medium text-muted-foreground" style={{ "--speaker-color": color } as CSSProperties}>{label}</span>
      {listener !== undefined && <>
        <span aria-hidden="true" className="text-subtle-foreground">→</span>
        <span className="truncate text-subtle-foreground">{listener?.trim() || "청자 미상"}</span>
      </>}
    </span>
  )
}
