import type { ReactNode } from "react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface SelectionToolboxAction {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}
export interface SelectionToolboxProps { actions: SelectionToolboxAction[]; className?: string }

/** Context actions placed beside the current canvas selection. */
export function SelectionToolbox({ actions, className }: SelectionToolboxProps) {
  if (!actions.length) return null
  return <div role="toolbar" aria-label="선택 항목 동작" className={cn("flex h-8 items-center gap-0.5 rounded-md border border-border bg-floating-toolbar text-floating-toolbar-foreground px-1 shadow-md", className)}>
    {actions.map((action, index) => <span key={action.id} className="contents">
      {index > 0 && <span aria-hidden="true" className="mx-0.5 h-4 border-l border-border-subtle" />}
      <Button variant="ghost" size="sm" disabled={action.disabled} onClick={action.onSelect} className="h-6 px-1.5 text-xs text-floating-toolbar-foreground hover:bg-floating-toolbar-foreground/10 hover:text-floating-toolbar-foreground" title={action.label}>
        {action.icon}<span>{action.label}</span>
      </Button>
    </span>)}
  </div>
}
