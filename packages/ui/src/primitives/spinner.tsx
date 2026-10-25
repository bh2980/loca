import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "../lib/utils"

function Spinner({ className, size, ...props }: React.ComponentProps<"svg"> & { /** `xs` is 12px; the default 14px. */ size?: "xs" }) {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      className={cn("size-3.5 animate-spin text-muted-foreground", size === "xs" && "size-3", className)}
      {...props}
    />
  )
}

export { Spinner }
