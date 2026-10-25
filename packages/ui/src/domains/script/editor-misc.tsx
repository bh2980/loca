import type * as React from "react"
import { PopoverContent } from "../../controls/popover"
import { Text } from "../../primitives/text"

/** "초안 보관됨": the note that the text is only a draft; it goes last in its row. */
export function EditorDraftNote({ children }: { children?: React.ReactNode }) {
  return <Text variant="caption" weight="medium" tone="warning" className="order-last">{children}</Text>
}

/** The small popover that offers a selected word of the source as a glossary term. */
export function EditorTermPopover(props: Omit<React.ComponentProps<typeof PopoverContent>, "className">) {
  return <PopoverContent {...props} className="space-y-2" />
}
