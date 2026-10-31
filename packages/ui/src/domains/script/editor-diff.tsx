import type * as React from "react"
import { SectionHeading } from "../../patterns/section"
import { Box } from "../../primitives/box"
import { Text } from "../../primitives/text"
import { cn } from "../../lib/utils"

/** One word of a word diff inside running text: struck through when removed, marked when added, plain otherwise. */
export function EditorDiffWord({ change, children }: { change?: "removed" | "added"; children?: React.ReactNode }) {
  return <span className={cn(change === "removed" && "text-danger line-through decoration-danger/60", change === "added" && "rounded-sm bg-success/15 text-success")}>{children}</span>
}

/** A word of a similar source that differs from this line's source. */
export function EditorChangedWord({ changed, children }: { changed?: boolean; children?: React.ReactNode }) {
  return <span className={cn(changed && "rounded-xs bg-warning/15 px-0.5 font-medium text-warning")}>{children}</span>
}

/** The framed "바뀐 곳" box: what the translation changed from the one before it; `actions` sit at the right of its heading. */
export function EditorPreviousDiff({ title, actions, children }: { title: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Box radius="md" border="all" background="page" paddingX="normal" paddingY="condensed" variant="body">
      <SectionHeading level="group" marginBottom="tight" actions={actions}>{title}</SectionHeading>
      <Text as="p" breakWords preserveLines>{children}</Text>
    </Box>
  )
}

/**
 * An AI 제안 waiting on a line: who made it beside the heading, 적용 · 거절 at its right, and its text (the words that differ
 * from the line's translation marked with EditorDiffWord). It is the one place a translator decides on an AI's text.
 */
export function EditorAiSuggestion({ meta, actions, children }: { meta?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div role="group" aria-label="AI 제안" className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
      <div className="mb-1 flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-accent">AI 제안</span>
        {meta && <span className="min-w-0 flex-1 truncate text-xs text-muted">{meta}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
      </div>
      <p className="break-words whitespace-pre-wrap">{children}</p>
    </div>
  )
}
