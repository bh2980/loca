import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/** The scrolling body of a page of forms or collections (settings): its inset and width tier. */
export function PageBody({ children, width = "default", fill = false, framed = false }: {
  children: ReactNode
  width?: "default" | "compact" | "wide"
  fill?: boolean
  /** A bounded surface for collections; callers keep their own inner scrolling. */
  framed?: boolean
}) {
  return (
    <div
      role="region"
      aria-label="설정 내용"
      tabIndex={fill ? undefined : 0}
      className="h-full min-h-0 flex-1 overflow-auto"
    >
      <div className={cn("w-full px-6 py-6", width === "wide" ? "max-w-6xl" : width === "compact" ? "max-w-4xl" : "max-w-3xl", fill && "h-full min-h-0")}>
        {framed ? <div className={cn("min-h-0 overflow-hidden rounded-lg border border-default bg-panel", fill && "h-full")}>{children}</div> : children}
      </div>
    </div>
  )
}
