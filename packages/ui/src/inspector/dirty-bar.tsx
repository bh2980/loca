import { Button } from "../primitives/button"

export interface DirtyBarProps {
  dirtyCount: number
  onRevert: () => void
  onSave: () => void
  saving?: boolean
  disabled?: boolean
}

export function DirtyBar({ dirtyCount, onRevert, onSave, saving = false, disabled = false }: DirtyBarProps) {
  if (dirtyCount <= 0) return null
  return (
    <>
      <span className="mr-auto text-xs text-muted-foreground">바뀐 곳 {dirtyCount}</span>
      <Button type="button" variant="outline" onClick={onRevert} disabled={disabled || saving}>되돌리기</Button>
      <Button type="button" onClick={onSave} disabled={disabled || saving} aria-busy={saving}>{saving ? "저장 중" : "저장"}</Button>
    </>
  )
}
