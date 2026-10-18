import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export function EmptySelection({ title = "선택 없음", children, className }: { title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  )
}
