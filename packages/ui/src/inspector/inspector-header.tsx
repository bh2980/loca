import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface InspectorHeaderProps {
  kind?: ReactNode
  icon?: ReactNode
  name: ReactNode
  status?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  className?: string
}

/** Header for an inspected item. Put secondary and destructive actions in the actions menu. */
export function InspectorHeader({
  kind,
  icon,
  name,
  status,
  actions,
  onClose,
  className,
}: InspectorHeaderProps) {
  return (
    <div className={cn("flex shrink-0 items-start gap-2 border-b border-border-subtle bg-panel px-4 py-3", className)}>
      {icon && <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>}
      <div className="min-w-0 flex-1">
        {kind && <div className="text-xs font-medium text-subtle-foreground">{kind}</div>}
        <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{name}</h2>
        {status != null && <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">{status}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      {onClose && (
        <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="닫기" className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
