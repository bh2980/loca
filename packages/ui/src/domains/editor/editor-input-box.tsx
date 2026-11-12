import type * as React from "react"
import { cn } from "../../lib/utils"

/** The box the translation editor's text field (CodeMirror) is mounted in: a bordered, focus-ringed field at reading size. */
export function EditorInputBox(props: Omit<React.HTMLAttributes<HTMLDivElement>, "className"> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      {...props}
      className={cn(
        "min-h-16 rounded-md border border-input bg-page px-3 py-2 text-base shadow-2xs transition-all focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40 md:text-sm",
        "text-base leading-6 md:text-base",
      )}
    />
  )
}
