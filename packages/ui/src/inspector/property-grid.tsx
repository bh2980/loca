import type { ReactNode } from "react"
import { HelpTip } from "../primitives/help-tip"
import { Label } from "../primitives/label"
import { cn } from "../lib/utils"

export function PropertyGrid({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[minmax(5rem,7rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-2", className)}>{children}</div>
}

export interface PropertyRowProps {
  label: ReactNode
  /** Associate an editable property's visible label with its control. Omit for read-only values. */
  htmlFor?: string
  children: ReactNode
  hint?: ReactNode
  className?: string
}

export function PropertyRow({ label, htmlFor, children, hint, className }: PropertyRowProps) {
  return (
    <div className={cn("col-span-2 grid grid-cols-subgrid items-center gap-x-3", className)}>
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {htmlFor ? <Label htmlFor={htmlFor} className="truncate text-muted-foreground">{label}</Label> : <span className="truncate">{label}</span>}
        {hint != null && <HelpTip>{hint}</HelpTip>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
