import type * as React from "react"
import { Spinner } from "../primitives/spinner"

/** A small status pill at the bottom of the window while the server cannot be reached ("서버에 연결하는 중…"). */
export function ServerNotice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="fixed bottom-10 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
      <Spinner size="xs" />
      {children}
    </div>
  )
}
