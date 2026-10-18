import { Grid2X2, Maximize, Minus, Plus, WandSparkles } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface CanvasToolbarProps {
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onLayout: () => void
  minimapVisible: boolean
  onToggleMinimap: () => void
  className?: string
}

/** Small canvas controls designed to float along the bottom edge of a graph. */
export function CanvasToolbar({ zoomPercent, onZoomIn, onZoomOut, onFit, onLayout, minimapVisible, onToggleMinimap, className }: CanvasToolbarProps) {
  return <div role="toolbar" aria-label="캔버스 도구" className={cn("flex h-9 items-center gap-0.5 rounded-md border border-border bg-popover px-1 shadow-sm", className)}>
    <Button variant="ghost" size="icon-xs" aria-label="축소" onClick={onZoomOut}><Minus /></Button>
    <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoomPercent)}%</span>
    <Button variant="ghost" size="icon-xs" aria-label="확대" onClick={onZoomIn}><Plus /></Button>
    <span className="mx-1 h-4 border-l border-border" />
    <Button variant="ghost" size="icon-xs" aria-label="화면에 맞춤" onClick={onFit}><Maximize /></Button>
    <Button variant="ghost" size="icon-xs" aria-label="자동 정렬" onClick={onLayout}><WandSparkles /></Button>
    <span className="mx-1 h-4 border-l border-border" />
    <Button variant={minimapVisible ? "secondary" : "ghost"} size="icon-xs" aria-label={minimapVisible ? "미니맵 숨기기" : "미니맵 표시"} aria-pressed={minimapVisible} onClick={onToggleMinimap}><Grid2X2 /></Button>
  </div>
}
