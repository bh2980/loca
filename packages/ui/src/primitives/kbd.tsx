import * as React from "react"
import { cn } from "../lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border bg-muted px-1 font-mono text-2xs font-medium text-muted-foreground shadow-2xs select-none",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
