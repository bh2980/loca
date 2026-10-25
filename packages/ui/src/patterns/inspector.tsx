import type { ReactNode } from "react"
import { ScrollArea } from "../controls/scroll-area"
import { Skeleton } from "./skeleton"
import { cn } from "../lib/utils"

export interface InspectorProps {
  children?: ReactNode
  header?: ReactNode
  tabs?: ReactNode
  footer?: ReactNode
  loading?: boolean
  /** Without its left rule and with room to shrink: inside a pane that has its own edge. */
  bare?: boolean
  /** The body without padding or spacing: its children are full-width rows. */
  flush?: boolean
  /** The footer's left side: the pane's destructive action (삭제, 버리기), apart from the primary action on the right. */
  footerStart?: ReactNode
}

function InspectorFooter({ children, start }: { children?: ReactNode; start?: ReactNode }) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-default bg-panel px-4 py-2.5">
      {start && <div className="flex items-center gap-2">{start}</div>}
      {children != null && children !== false && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>}
    </footer>
  )
}

/** Right-docked inspector shell with a fixed header, scrollable body, and optional footer. */
export function Inspector({
  children,
  header,
  tabs,
  footer,
  loading = false,
  bare,
  flush,
  footerStart,
}: InspectorProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col border-l border-default bg-panel", bare && "min-w-0 border-l-0")}>
      {header}
      {tabs}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="space-y-inspector-compact p-4" aria-label="불러오는 중" aria-busy="true">
            <Skeleton shape="line" width="1/2" />
            <Skeleton height="placeholder-sm" />
            <Skeleton shape="line" width="2/3" />
          </div>
        ) : (
          <div className={cn("space-y-0", flush && "p-0")}>{children}</div>
        )}
      </ScrollArea>
      {((footer != null && footer !== false) || footerStart) && <InspectorFooter start={footerStart}>{footer}</InspectorFooter>}
    </div>
  )
}
