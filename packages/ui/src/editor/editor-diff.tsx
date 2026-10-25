import type * as React from "react"
import { GroupHeading } from "../primitives/heading"
import { cn } from "../lib/utils"

/** One word of a word diff inside running text: struck through when removed, marked when added, plain otherwise. */
export function EditorDiffWord({ change, children }: { change?: "removed" | "added"; children?: React.ReactNode }) {
  return <span className={cn(change === "removed" && "text-destructive line-through decoration-destructive/60", change === "added" && "rounded-sm bg-success/15 text-success")}>{children}</span>
}

/** A word of a similar source that differs from this line's source. */
export function EditorChangedWord({ changed, children }: { changed?: boolean; children?: React.ReactNode }) {
  return <span className={cn(changed && "rounded-xs bg-warning/15 px-0.5 font-medium text-warning")}>{children}</span>
}

/** The framed text of a diff under the editor: a short note's body (no heading). */
export function EditorChangeNote({ children }: { children?: React.ReactNode }) {
  return <div className="space-y-0.5 rounded-md border bg-background px-2 py-1.5 text-sm">{children}</div>
}

/** The framed "바뀐 곳" box: what the translation changed from the one before it; `actions` sit at the right of its heading. */
export function EditorPreviousDiff({ title, actions, children }: { title: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm">
      <GroupHeading className="mb-1" actions={actions}>{title}</GroupHeading>
      <p className="break-words whitespace-pre-wrap">{children}</p>
    </div>
  )
}
