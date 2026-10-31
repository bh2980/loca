import type { ComponentProps } from "react"
import { cn } from "../../lib/utils"
import { SelectTrigger } from "../../controls/select"

/**
 * The select trigger that reads as the speaker row's text: `unknown` shows it in the warning color. It writes the arrow before the
 * name itself; `arrow={false}` leaves it to a place that has the arrow outside, so only the name is the button.
 */
export function ScriptInlineListenerTrigger({ unknown, label, arrow = true, ...props }: Omit<ComponentProps<typeof SelectTrigger>, "children" | "className"> & { unknown: boolean; label: string; arrow?: boolean }) {
  return (
    <SelectTrigger
      {...props}
      className={cn("h-auto min-w-0 gap-0.5 border-0 data-[size=default]:h-auto bg-transparent p-0 text-xs shadow-none hover:underline dark:bg-transparent dark:hover:bg-transparent [&>svg]:size-3", unknown ? "text-warning" : "text-muted")}
    >
      <span className="inline-flex min-w-0 items-center gap-1 truncate"><span className="truncate">{arrow ? "→ " : ""}{label}</span></span>
    </SelectTrigger>
  )
}

