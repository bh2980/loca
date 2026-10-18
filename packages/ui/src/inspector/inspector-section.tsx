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

const inspectorBlockStyles = "scroll-mt-4 border-b border-border-subtle px-4 py-3.5"

/** A non-collapsible block that follows the same inset and divider contract as inspector sections. */
export function InspectorBlock({ children, className, id }: { children?: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cn(inspectorBlockStyles, className)}>{children}</section>
}

export function InspectorSection({ title, children, actions, defaultOpen = true, id, className }: InspectorSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <section id={id} className={cn(inspectorBlockStyles, "space-y-3", className)}>
        <div className="flex min-h-6 items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group -ml-1.5 h-6 min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-xs font-semibold text-foreground hover:bg-accent/50"
            >
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
              <span className="truncate">{title}</span>
            </Button>
          </CollapsibleTrigger>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <CollapsibleContent className="space-y-3">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  )
}
