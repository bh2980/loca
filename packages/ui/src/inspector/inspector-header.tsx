import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface InspectorHeaderProps {
  kind?: ReactNode
  name: ReactNode
  status?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  className?: string
}

/** Header for an inspected item. Put secondary and destructive actions in the actions menu. */
export function InspectorHeader({
  kind,
  name,
  status,
  actions,
  onClose,
  className,
}: InspectorHeaderProps) {
  return (
    <div className={cn("flex shrink-0 items-start gap-2 border-b border-border bg-background px-3.5 py-2.5", className)}>
      <div className="min-w-0 flex-1">
        {kind && <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{kind}</div>}
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-foreground">{name}</h2>
          {status}
        </div>
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
