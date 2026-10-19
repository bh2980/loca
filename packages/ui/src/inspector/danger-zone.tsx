import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { SectionHeading } from "../primitives/heading"
import { InspectorBlock } from "./inspector-section"

export function DangerZone({ title = "위험 구역", children, className }: { title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <InspectorBlock className={cn("space-y-3", className)}>
      <SectionHeading className="text-destructive">{title}</SectionHeading>
      {children}
    </InspectorBlock>
  )
}
