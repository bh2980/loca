import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface InspectorSectionProps {
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
  /** Given, the section folds and starts open or closed; without it the section is plain (most are). */
  defaultOpen?: boolean
  /** Fold even without a default (rarely needed: pass defaultOpen instead). */
  collapsible?: boolean
  id?: string
  className?: string
  /** Keeps its height in a column that scrolls (it never shrinks). */
  noShrink?: boolean
}

const inspectorBlockStyles = "scroll-mt-4 border-b border-border-subtle px-4 py-3.5"

/** A non-collapsible block that follows the same inset and divider contract as inspector sections. */
export function InspectorBlock({ children, className, id }: { children?: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cn(inspectorBlockStyles, className)}>{children}</section>
}

/**
 * A titled part of a pane. Plain by default: a pane is a few sections the eye reads top to bottom, and
 * a chevron on each one is noise. Only long or occasional parts fold (문맥, 고급, 프롬프트, 이력): give
 * them `defaultOpen`.
 */
export function InspectorSection({ title, children, actions, defaultOpen, collapsible, id, className, noShrink }: InspectorSectionProps) {
  const extra = cn(className, noShrink && "shrink-0")
  const folds = collapsible ?? defaultOpen !== undefined
  if (!folds)
    return (
      <section id={id} className={cn(inspectorBlockStyles, "space-y-3", extra)}>
        <div className="flex min-h-7 items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</h3>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        {children}
      </section>
    )
  return (
    <Collapsible defaultOpen={defaultOpen ?? true} asChild>
      <section id={id} className={cn(inspectorBlockStyles, "space-y-3", extra)}>
        <div className="flex min-h-7 items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group -ml-1.5 h-7 min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-sm font-semibold text-foreground hover:bg-accent/50"
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
