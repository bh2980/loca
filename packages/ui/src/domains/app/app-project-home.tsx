import { Slot } from "@radix-ui/react-slot"
import type * as React from "react"
import { cn } from "../../lib/utils"

/** Makes the link inside it a status chip (a small rounded target that tints on hover). */
export function StatusChipLink({ children }: { children: React.ReactNode }) {
  return <Slot className="flex items-center gap-1 rounded-xs px-2 py-1 text-sm hover:bg-sunken transition-colors">{children}</Slot>
}

/** The icon tile at the start of a to-do; `alert` tints it as a problem. */
export function TodoIcon({ alert, children }: { alert?: boolean; children: React.ReactNode }) {
  return <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md bg-sunken [&_svg]:size-4", alert && "bg-danger/10 text-danger")}>{children}</span>
}

/** The number (or check) circle of a step: `done`, the `current` one, or still to do. */
export function StepMarker({ state, children }: { state: "done" | "current" | "todo"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
        state === "done" ? "border-success bg-success text-inverse" : state === "current" ? "border-strong font-medium text-default" : "text-muted",
      )}
    >
      {children}
    </span>
  )
}
