import type * as React from "react"
import { TooltipContent } from "../../controls/tooltip"
import { Text } from "../../primitives/text"
import { cn } from "../../lib/utils"

/**
 * A line of translation or source text that keeps its own breaks. `look`: `suggestion` is the text of a suggestion row; `removed` and
 * `added` are words of a diff (inline, struck through / marked); `plain` is a diff word that did not change (inline).
 */
export function EditorTokenText({ look, children }: { look?: "suggestion" | "removed" | "added" | "plain"; children?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "block break-words whitespace-pre-wrap",
        look === "suggestion" && "min-w-0 text-sm leading-5 text-default [overflow-wrap:anywhere]",
        look && look !== "suggestion" && "inline",
        look === "removed" && "text-danger line-through decoration-danger/60",
        look === "added" && "rounded-sm bg-success/15 text-success",
      )}
    >
      {children}
    </span>
  )
}

/** A paragraph of a line's source: keeps its breaks, wraps long words. */
export function EditorSourceParagraph({ children }: { children?: React.ReactNode }) {
  return <Text as="p" breakWords preserveLines>{children}</Text>
}

/** A numbered format token chip. `hue` is the token's colour class; `stray` is a token the source lacks; `missing` is one the translation lacks; `pickable` puts it at the cursor on press. */
export function EditorTokenChip({ hue, stray, missing, pickable, ...props }: Omit<React.HTMLAttributes<HTMLSpanElement>, "className"> & { ref?: React.Ref<HTMLSpanElement>; hue: string; stray?: boolean; missing?: boolean; pickable?: boolean }) {
  return <span {...props} className={cn("token-chip", hue, stray && "token-chip-stray", missing && "ring-1 ring-warning", pickable && "cursor-pointer hover:border-focus")} />
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
export function EditorTermMark({ dotted, pickable, ...props }: Omit<React.HTMLAttributes<HTMLSpanElement>, "className"> & { ref?: React.Ref<HTMLSpanElement>; dotted?: boolean; pickable?: boolean }) {
  return (
    <span
      {...props}
      className={cn(dotted ? "underline decoration-accent/45 decoration-dotted underline-offset-4" : "underline decoration-accent/40 decoration-2 underline-offset-4", pickable && "cursor-pointer hover:decoration-accent")}
    />
  )
}
