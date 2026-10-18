import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface DirtyBarProps {
  dirtyCount: number
  onRevert: () => void
  onSave: () => void
  saving?: boolean
  disabled?: boolean
  className?: string
}

export function DirtyBar({ dirtyCount, onRevert, onSave, saving = false, disabled = false, className }: DirtyBarProps) {
  if (dirtyCount <= 0) return null
  return (
    <footer className={cn("sticky bottom-0 flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-panel px-4 py-3", className)}>
      <span className="mr-auto text-xs text-muted-foreground">바뀐 곳 {dirtyCount}</span>
      <Button type="button" variant="outline" onClick={onRevert} disabled={disabled || saving}>되돌리기</Button>
      <Button type="button" onClick={onSave} disabled={disabled || saving} aria-busy={saving}>{saving ? "저장 중" : "저장"}</Button>
    </footer>
  )
}
