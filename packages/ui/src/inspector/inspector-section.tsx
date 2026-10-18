import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface InspectorSectionProps {
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
  defaultOpen?: boolean
  id?: string
  className?: string
}

export function InspectorSection({ title, children, actions, defaultOpen = true, id, className }: InspectorSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <section id={id} className={cn("scroll-mt-4 space-y-inspector-compact border-b border-border-subtle px-5 py-3", className)}>
        <div className="flex min-h-7 items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="group h-7 min-w-0 justify-start gap-1 px-1 text-sm font-semibold">
              <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
              <span className="truncate">{title}</span>
            </Button>
          </CollapsibleTrigger>
          {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <CollapsibleContent className="space-y-inspector-compact">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  )
}
