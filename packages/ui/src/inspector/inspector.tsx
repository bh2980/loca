import type { ReactNode } from "react"
import { ScrollArea } from "../primitives/scroll-area"
import { Skeleton } from "../primitives/skeleton"
import { cn } from "../lib/utils"

export interface InspectorProps {
  children?: ReactNode
  header?: ReactNode
  tabs?: ReactNode
  footer?: ReactNode
  loading?: boolean
  className?: string
  bodyClassName?: string
}

export function InspectorFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <footer className={cn("flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-panel px-4 py-2.5", className)}>
      {children}
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
  className,
  bodyClassName,
}: InspectorProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col border-l border-border bg-panel", className)}>
      {header}
      {tabs}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="space-y-inspector-compact p-4" aria-label="불러오는 중" aria-busy="true">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-16" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ) : (
          <div className={cn("space-y-0", bodyClassName)}>{children}</div>
        )}
      </ScrollArea>
      {footer != null && footer !== false && <InspectorFooter>{footer}</InspectorFooter>}
    </div>
  )
}
