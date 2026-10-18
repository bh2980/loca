import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export function AdvancedDisclosure({ children, label = "고급", className }: { children?: ReactNode; label?: ReactNode; className?: string }) {
  return (
    <Collapsible defaultOpen={false} className={cn("space-y-3", className)}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="group h-7 gap-1 px-1 text-muted-foreground">
          <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}
