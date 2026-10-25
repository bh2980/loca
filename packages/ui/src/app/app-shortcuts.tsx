import type * as React from "react"
import { PopoverContent } from "../primitives/popover"

/** The shortcut list's popover: tall as the window allows, scrolling inside, no padding of its own. */
export function ShortcutPopoverContent(props: Omit<React.ComponentProps<typeof PopoverContent>, "className">) {
  return <PopoverContent className="max-h-[80vh] w-96 overflow-auto p-0" {...props} />
}

/** One group of shortcuts, a hairline apart from the next. */
export function ShortcutSection({ children }: { children: React.ReactNode }) {
  return <section className="border-b px-4 py-3 last:border-b-0">{children}</section>
}
