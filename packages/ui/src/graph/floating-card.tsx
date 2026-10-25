import * as React from "react"
import { cn } from "../lib/utils"

/** A card that floats beside its graph node (not a modal: the graph stays usable around it). Takes the focus itself (`tabIndex={-1}`) so its keys work. */
export const FloatingCard = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-2 rounded-lg border bg-popover outline-none p-3 text-popover-foreground shadow-lg", className)} {...props} />
))
FloatingCard.displayName = "FloatingCard"
