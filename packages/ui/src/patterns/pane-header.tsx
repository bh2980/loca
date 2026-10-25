import type { ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "../controls/button"

export interface PaneHeaderProps {
  kicker?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  onClose?: () => void
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
}: PaneHeaderProps) {
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-default bg-page px-3 py-2">
      {icon && <div className="mt-0.5 shrink-0 text-muted">{icon}</div>}
      <div className="min-w-0 flex-1">
        {kicker && (
          <div className="text-xs text-muted">
            {kicker}
          </div>
        )}
        <h2 className="truncate text-base font-semibold text-default">
          {title}
        </h2>
        {subtitle && (
          <div className="mt-0.5 truncate text-xs text-muted">
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
          className="shrink-0 text-muted hover:text-default"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
