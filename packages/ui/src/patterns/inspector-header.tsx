import type { ReactNode } from "react"
import { ChevronLeft, X } from "lucide-react"
import { Button } from "../controls/button"
import { useHasDock } from "./right-dock"

export interface InspectorHeaderProps {
  kind?: ReactNode
  icon?: ReactNode
  name: ReactNode
  status?: ReactNode
  actions?: ReactNode
  /** A row of its own under the rest, the header's full width (the tags of a line). */
  below?: ReactNode
  onClose?: () => void
  /** A view opened from another (editing a line's source): a ‹ before the title goes back to it, docked or not. */
  onBack?: () => void
}

/**
 * Header for an inspected item. Put secondary and destructive actions in the actions menu. Docked at the right it has no close
 * button of its own (the dock's fold button is the one way to close; the selection stays); elsewhere `onClose` shows one.
 */
export function InspectorHeader({
  kind,
  icon,
  name,
  status,
  actions,
  below,
  onClose,
  onBack,
}: InspectorHeaderProps) {
  const docked = useHasDock()
  return (
    <div className="shrink-0 border-b border-default bg-panel px-4 py-3">
    <div className="flex items-start gap-2">
      {onBack && (
        <Button type="button" variant="ghost" size="icon-xs" onClick={onBack} aria-label="돌아가기" title="돌아가기 (Esc)" className="-ml-1 mt-0.5 shrink-0 text-muted hover:text-default">
          <ChevronLeft className="size-4" />
        </Button>
      )}
      {icon && <div className="mt-0.5 shrink-0 text-muted">{icon}</div>}
      <div className="min-w-0 flex-1">
        {kind && <div className="text-xs text-muted">{kind}</div>}
        <h2 className="truncate text-base font-semibold leading-snug text-default">{name}</h2>
        {status != null && <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">{status}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      {onClose && !docked && (
        <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label="닫기" className="shrink-0 text-muted hover:text-default">
          <X className="size-3.5" />
        </Button>
      )}
    </div>
    {below && <div className="mt-2 min-w-0 space-y-2">{below}</div>}
    </div>
  )
}
