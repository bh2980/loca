import { Grid2X2, Maximize, Minus, Plus, WandSparkles } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"
import { CanvasDirectionControl, type CanvasDirection } from "./canvas-direction-control"

export interface CanvasToolbarProps {
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onResetZoom?: () => void
  onLayout?: () => void
  minimapVisible?: boolean
  onToggleMinimap?: () => void
  layoutLabel?: string
  direction?: CanvasDirection
  onDirectionChange?: (direction: CanvasDirection) => void
  directionDisabled?: boolean
  className?: string
}

/** Small canvas controls designed to float along the bottom edge of a graph. */
export function CanvasToolbar({ zoomPercent, onZoomIn, onZoomOut, onFit, onResetZoom, onLayout, minimapVisible, onToggleMinimap, layoutLabel, direction, onDirectionChange, directionDisabled, className }: CanvasToolbarProps) {
  return <div role="toolbar" aria-label="캔버스 도구" className={cn("flex h-9 items-center gap-0.5 rounded-md border border-border bg-popover px-1 shadow-sm", className)}>
    <Button variant="ghost" size="icon-xs" aria-label="축소" onClick={onZoomOut}><Minus /></Button>
    {onResetZoom ? (
      <Button variant="ghost" size="xs" className="min-w-10 px-1 text-xs tabular-nums text-muted-foreground" aria-label="읽기 크기 100%" title="읽기 크기 100%" onClick={onResetZoom}>{Math.round(zoomPercent)}%</Button>
    ) : (
      <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoomPercent)}%</span>
    )}
    <Button variant="ghost" size="icon-xs" aria-label="확대" onClick={onZoomIn}><Plus /></Button>
    <span className="mx-1 h-4 border-l border-border" />
    <Button variant="ghost" size="icon-xs" aria-label="화면에 맞춤" onClick={onFit}><Maximize /></Button>
    {onLayout && <Button variant="ghost" size={layoutLabel ? "sm" : "icon-xs"} aria-label={layoutLabel ?? "자동 정렬"} title={layoutLabel ?? "자동 정렬"} onClick={onLayout}><WandSparkles />{layoutLabel}</Button>}
    {direction && onDirectionChange && <>
      <span className="mx-1 h-4 border-l border-border" />
      <CanvasDirectionControl direction={direction} onDirectionChange={onDirectionChange} disabled={directionDisabled} variant="ghost" />
    </>}
    {onToggleMinimap && minimapVisible !== undefined && <>
      <span className="mx-1 h-4 border-l border-border" />
      <Button variant={minimapVisible ? "secondary" : "ghost"} size="icon-xs" aria-label={minimapVisible ? "미니맵 숨기기" : "미니맵 표시"} aria-pressed={minimapVisible} onClick={onToggleMinimap}><Grid2X2 /></Button>
    </>}
  </div>
}
