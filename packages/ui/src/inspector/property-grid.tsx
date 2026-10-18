import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export function PropertyGrid({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-xs", className)}>{children}</div>
}

export interface PropertyRowProps {
  label: ReactNode
  children: ReactNode
  description?: ReactNode
  className?: string
}

export function PropertyRow({ label, children, description, className }: PropertyRowProps) {
  return (
    <div className={cn("col-span-2 grid grid-cols-subgrid items-center gap-x-3 gap-y-1", className)}>
      <div className="min-w-0 self-start pt-1">
        <div className="min-w-0 whitespace-normal break-words text-xs font-medium text-muted-foreground">{label}</div>
      </div>
      <div className="min-w-0 text-xs">{children}</div>
      {description != null && <p className="col-span-2 text-xs font-normal text-muted-foreground">{description}</p>}
    </div>
  )
}
