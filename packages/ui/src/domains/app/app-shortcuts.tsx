import type * as React from "react"

/** One group of shortcuts, a hairline apart from the next. */
export function ShortcutSection({ children }: { children: React.ReactNode }) {
  return <section className="border-b px-4 py-3 last:border-b-0">{children}</section>
}
