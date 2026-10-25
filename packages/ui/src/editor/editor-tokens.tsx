import type * as React from "react"
import { TooltipContent } from "../primitives/tooltip"
import { cn } from "../lib/utils"

/**
 * A line of translation or source text that keeps its own breaks. `look`: `suggestion` is the text of a suggestion row; `removed` and
 * `added` are words of a diff (inline, struck through / marked); `plain` is a diff word that did not change (inline).
 */
export function EditorTokenText({ look, className, children }: { look?: "suggestion" | "removed" | "added" | "plain"; className?: string; children?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "block break-words whitespace-pre-wrap",
        look === "suggestion" && "min-w-0 text-sm leading-5 text-foreground [overflow-wrap:anywhere]",
        look && look !== "suggestion" && "inline",
        look === "removed" && "text-destructive line-through decoration-destructive/60",
        look === "added" && "rounded-sm bg-success/15 text-success",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A paragraph of a line's source: keeps its breaks, wraps long words. */
export function EditorSourceParagraph({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <p className={cn("break-words whitespace-pre-wrap", className)}>{children}</p>
}

/** A numbered format token chip. `hue` is the token's colour class; `stray` is a token the source lacks; `missing` is one the translation lacks; `pickable` puts it at the cursor on press. */
export function EditorTokenChip({ hue, stray, missing, pickable, ...props }: React.HTMLAttributes<HTMLSpanElement> & { ref?: React.Ref<HTMLSpanElement>; hue: string; stray?: boolean; missing?: boolean; pickable?: boolean }) {
  return <span {...props} className={cn("token-chip", hue, stray && "token-chip-stray", missing && "ring-1 ring-warning", pickable && "cursor-pointer hover:border-ring")} />
}

/** The tooltip of a format token: the token itself, then why it stands out and what pressing it does. */
export function EditorTokenTip({ text, stray, hint }: { text: string; stray?: boolean; hint?: string }) {
  return (
    <TooltipContent className="max-w-md text-sm">
      <span className="font-mono break-all">{text}</span>
      {stray && <span className="block opacity-70">원문에 없는 서식</span>}
      {hint && <span className="block opacity-70">{hint}</span>}
    </TooltipContent>
  )
}

/** A glossary term inside a source: solid underline when it can be pressed to put its translation at the cursor, `dotted` when it only marks the term. */
export function EditorTermMark({ dotted, pickable, ...props }: React.HTMLAttributes<HTMLSpanElement> & { ref?: React.Ref<HTMLSpanElement>; dotted?: boolean; pickable?: boolean }) {
  return (
    <span
      {...props}
      className={cn(dotted ? "underline decoration-primary/45 decoration-dotted underline-offset-4" : "underline decoration-primary/40 decoration-2 underline-offset-4", pickable && "cursor-pointer hover:decoration-primary")}
    />
  )
}
