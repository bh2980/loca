import type * as React from "react"
import { Button } from "../../controls/button"
import { Box } from "../../primitives/box"
import { cn } from "../../lib/utils"

/**
 * The box under the editor that holds the candidates and similar translations the translator can take: a numbered list of
 * `EditorSuggestionRow`s divided by hairlines, and (given `onMore`) a full-width quiet button under it.
 */
export function EditorSuggestionList({ label, onMore, moreLabel, children }: { label: string; onMore?: () => void; moreLabel?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Box aria-label={label} overflow="hidden" radius="md" border="all" borderColor="default" background="panel">
      <ol className="divide-y divide-subtle">{children}</ol>
      {onMore && (
        <Button variant="ghost" size="inline" height="auto" width="full" justifyContent="center" radius="none" border="top" borderColor="subtle" paddingY="tight" onClick={onMore}>
          {moreLabel}
        </Button>
      )}
    </Box>
  )
}

/**
 * One suggestion as a whole-row button: its shortcut key on the left, its text and notes beside it. `hintHidden` keeps the key's
 * room but does not show it (suggestions past the first few have no shortcut).
 */
export function EditorSuggestionRow({ hint, hintHidden, onPick, children }: { hint: string; hintHidden?: boolean; onPick: () => void; children?: React.ReactNode }) {
  return (
    <Button variant="ghost" size="row" className="group flex h-auto w-full items-start gap-2 rounded-none px-2 py-1.5 text-left hover:bg-hover" onClick={onPick}>
      <kbd className={cn("mt-0.5 inline-flex min-w-8 shrink-0 select-none items-center justify-center rounded border border-default bg-surface px-1 py-0.5 font-mono text-2xs font-semibold text-muted group-hover:border-accent/40 group-hover:text-default", hintHidden && "invisible")}>
        {hint}
      </kbd>
      <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
    </Button>
  )
}
