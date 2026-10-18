import * as React from "react"
import { cn } from "../lib/utils"
import { useControlId } from "./control-id"

function Textarea({ className, id, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      id={useControlId(id)}
      data-slot="textarea"
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-xs transition-colors outline-none",
        "placeholder:text-muted-foreground hover:border-border",
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
