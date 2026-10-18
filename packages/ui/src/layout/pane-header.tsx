import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface PaneHeaderProps {
  kicker?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  className?: string
}

/**
 * Clean flat pane header for side drawers, inspector columns, and detail views.
 */
export function PaneHeader({
  kicker,
  title,
  subtitle,
  icon,
  actions,
  onClose,
  className,
}: PaneHeaderProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-2 border-b border-border bg-background px-3.5 py-2.5",
        className
      )}
    >
      {icon && <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>}
      <div className="min-w-0 flex-1">
        {kicker && (
          <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            {kicker}
          </div>
        )}
        <h2 className="truncate text-xs font-semibold text-foreground tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <div className="mt-0.5 truncate text-2xs text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="닫기"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
