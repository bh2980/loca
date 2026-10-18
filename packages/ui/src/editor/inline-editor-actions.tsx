import type { ReactNode } from "react"
import { cn } from "../lib/utils"

/** Action slots for a focused editor row. Callers supply Buttons to keep labels and behavior local. */
export function InlineEditorActions({ primary, ai, overflow, className }: { primary: ReactNode; ai?: ReactNode; overflow?: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 items-center gap-1.5", className)}>{primary}{ai}{overflow}</div>
}
