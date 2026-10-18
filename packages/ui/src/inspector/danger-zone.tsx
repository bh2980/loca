import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export function DangerZone({ title = "위험 구역", children, className }: { title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 rounded-md border border-destructive/30 bg-muted/30 p-4", className)}>
      <h3 className="text-sm font-semibold text-destructive">{title}</h3>
      {children}
    </section>
  )
}
