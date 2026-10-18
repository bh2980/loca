import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

/** Flex-shrink-safe frame for measured graph canvases and their floating controls. */
export function CanvasSurface({ className, grow = true, ...props }: ComponentProps<"div"> & { grow?: boolean }) {
  return (
    <div
      {...props}
      className={cn(
        "relative min-h-0 min-w-0 overflow-hidden bg-graph-canvas bg-[radial-gradient(var(--graph-grid)_1px,transparent_1px)] [background-size:20px_20px]",
        grow ? "flex-1" : "flex-none",
        className,
      )}
    />
  )
}
