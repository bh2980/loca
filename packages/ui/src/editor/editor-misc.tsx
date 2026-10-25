import type * as React from "react"
import { DropdownMenuContent } from "../primitives/dropdown-menu"
import { PopoverContent } from "../primitives/popover"
import { Text } from "../primitives/text"

/** An icon and its label in a line of notes (a status, a failed check). */
export function EditorInlineLabel(props: React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className="inline-flex items-center gap-1" />
}

/** "초안 보관됨": the note that the text is only a draft; it goes last in its row. */
export function EditorDraftNote({ children }: { children?: React.ReactNode }) {
  return <Text variant="caption" weight="medium" tone="warning" className="order-last">{children}</Text>
}

/** The menu of the editor's less used actions. */
export function EditorMenuContent(props: React.ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent {...props} className="min-w-48" />
}

/** The small popover that offers a selected word of the source as a glossary term. */
export function EditorTermPopover(props: React.ComponentProps<typeof PopoverContent>) {
  return <PopoverContent {...props} className="w-72 space-y-2 p-3" />
}
