import type { ReactNode } from "react"
import { CircleHelp } from "lucide-react"
import { Button } from "./button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

export function HelpTip({ children, label = "도움말" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} className="size-5 text-subtle-foreground">
          <CircleHelp className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  )
}
