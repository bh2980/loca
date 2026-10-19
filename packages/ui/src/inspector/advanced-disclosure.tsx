import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"
import { InspectorSection } from "./inspector-section"

export function AdvancedDisclosure({ children, label = "고급", className, variant = "default" }: { children?: ReactNode; label?: ReactNode; className?: string; variant?: "default" | "inspector" }) {
  if (variant === "inspector") return <InspectorSection title={label} defaultOpen={false} className={className}>{children}</InspectorSection>

  return (
    <Collapsible defaultOpen={false} className={cn("rounded-md border border-border-subtle bg-muted/20", className)}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="group flex h-8 w-full items-center justify-between gap-2 rounded-md px-3 text-xs font-medium text-foreground hover:bg-accent/50">
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-border-subtle px-3 py-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}
