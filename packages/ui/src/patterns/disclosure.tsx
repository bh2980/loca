import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible"
import { Button } from "../controls/button"

/** A boxed part that starts folded: its label and a turning chevron, the content opens under it. */
export function Disclosure({ children, label = "고급" }: { children?: ReactNode; label?: ReactNode }) {
  return (
    <Collapsible defaultOpen={false} className="rounded-md border border-subtle bg-sunken/20">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="group flex h-8 w-full items-center justify-between gap-2 rounded-md px-3 text-xs font-medium text-default hover:bg-hover/50">
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted transition-transform group-data-[state=closed]:-rotate-90" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-subtle px-3 py-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}
