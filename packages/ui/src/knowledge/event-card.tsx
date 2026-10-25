import { cn } from "../lib/utils"
import type * as React from "react"

/**
 * The card of one event in the 사건 흐름 (a React Flow node body): a quiet card that is framed when selected or targeted, dashed while the
 * event is a candidate, and framed under the pointer while a line is being drawn (`drawing`). Its connecting dots show on hover (group `event`).
 * `style` carries the measured card size.
 */
export function EventFlowCard({ framed, drawing, candidate, style, children }: { framed?: boolean; drawing?: boolean; candidate?: boolean; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "group/event flex flex-col rounded-md border bg-background px-3 py-2 text-left shadow-xs",
        framed && "border-primary ring-2 ring-primary/30",
        drawing && "hover:border-primary hover:ring-2 hover:ring-primary/30",
        candidate && "border-dashed",
      )}
      style={style}
    >
      {children}
    </div>
  )
}
