import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "../lib/utils"

function Spinner({ size, tone, fixed, ...props }: Omit<React.ComponentProps<"svg">, "className"> & {
  /** `xs` is 12px; the default 14px. */
  size?: "xs"
  /** `accent` in the accent color; the default is muted. */
  tone?: "accent"
  /** Does not shrink in a row. */
  fixed?: boolean
}) {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      className={cn("size-3.5 animate-spin text-muted", size === "xs" && "size-3", tone === "accent" && "text-accent", fixed && "shrink-0")}
      {...props}
    />
  )
}

export { Spinner }
