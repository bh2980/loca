import type { CSSProperties } from "react"
import { cn } from "../lib/utils"
import "./editor.css"

const SPEAKER_HUES = [2, 3, 5, 6, 7, 8, 9, 10, 11, 12]

function speakerHue(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return SPEAKER_HUES[hash % SPEAKER_HUES.length]
}

export function SpeakerIdentity({ speaker, listener, className, avatar = "theme" }: { speaker: string; listener?: string | null; className?: string; avatar?: "theme" | "always" }) {
  const initial = [...speaker.trim()][0]?.toLocaleUpperCase() ?? "?"
  const color = `var(--hue-${speakerHue(speaker)})`
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs", className)}>
      <span aria-hidden="true" className={cn("speaker-avatar hidden size-4 shrink-0 items-center justify-center rounded-full text-xs font-medium", avatar === "always" ? "flex" : "dark:flex")} style={{ "--speaker-color": color } as CSSProperties}>{initial}</span>
      <span className="speaker-name truncate font-medium text-muted-foreground" style={{ "--speaker-color": color } as CSSProperties}>{speaker}</span>
      {listener !== undefined && <><span aria-hidden="true" className="text-subtle-foreground">→</span><span className="truncate text-subtle-foreground">{listener || "청자 미상"}</span></>}
    </span>
  )
}
