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
