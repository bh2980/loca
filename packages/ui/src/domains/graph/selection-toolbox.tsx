import type { ReactNode } from "react"
import { Button } from "../../controls/button"

interface SelectionToolboxAction {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}
interface SelectionToolboxProps { actions: SelectionToolboxAction[] }

/** Context actions placed beside the current canvas selection. */
export function SelectionToolbox({ actions }: SelectionToolboxProps) {
  if (!actions.length) return null
  return <div role="toolbar" aria-label="선택 항목 동작" className="flex h-8 items-center gap-0.5 rounded-md border border-default bg-floating-toolbar text-floating-toolbar px-1 shadow-md">
    {actions.map((action, index) => <span key={action.id} className="contents">
      {index > 0 && <span aria-hidden="true" className="mx-0.5 h-4 border-l border-subtle" />}
      <Button variant="ghost" size="sm" disabled={action.disabled} onClick={action.onSelect} className="h-6 px-1.5 text-xs text-floating-toolbar hover:bg-floating-toolbar-hover hover:text-floating-toolbar" title={action.label}>
        {action.icon}<span>{action.label}</span>
      </Button>
    </span>)}
  </div>
}
