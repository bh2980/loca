import type * as React from "react"
import { Badge } from "../primitives/badge"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

/** The box under the editor that holds the candidates and similar translations the translator can take. */
export function EditorSuggestionPanel(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className="overflow-hidden rounded-md border border-border bg-panel" />
}

/** The numbered list of suggestions, divided by hairlines. */
export function EditorSuggestionItems(props: React.HTMLAttributes<HTMLOListElement>) {
  return <ol {...props} className="divide-y divide-border-subtle" />
}

/**
 * One suggestion as a whole-row button: its shortcut key on the left, its text and notes beside it. `hintHidden` keeps the key's
 * room but does not show it (suggestions past the first few have no shortcut).
 */
export function EditorSuggestionRow({ hint, hintHidden, onPick, children }: { hint: string; hintHidden?: boolean; onPick: () => void; children?: React.ReactNode }) {
  return (
    <Button variant="ghost" size="row" className="group flex h-auto w-full items-start gap-2 rounded-none px-2 py-1.5 text-left hover:bg-accent" onClick={onPick}>
      <kbd className={cn("mt-0.5 inline-flex min-w-8 shrink-0 select-none items-center justify-center rounded border border-border bg-card px-1 py-0.5 font-mono text-2xs font-semibold text-muted-foreground group-hover:border-primary/40 group-hover:text-foreground", hintHidden && "invisible")}>
        {hint}
      </kbd>
      <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
    </Button>
  )
}

/** Where a suggestion comes from (AI, a person, the same source elsewhere), on its own line above the text. */
export function EditorSuggestionOrigin({ children }: { children?: React.ReactNode }) {
  return <Badge variant="outline" className="max-w-full truncate">{children}</Badge>
}

/** "+N개 더보기" under the list: a full-width quiet button. */
export function EditorSuggestionMore({ onClick, children }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <Button variant="ghost" size="inline" className="h-auto w-full justify-center rounded-none border-t border-border-subtle py-1 text-xs text-muted-foreground" onClick={onClick}>
      {children}
    </Button>
  )
}
