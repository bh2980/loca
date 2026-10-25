import { ChevronsDownUp, ChevronsUpDown, Grid2X2, Maximize, Minus, Plus, WandSparkles } from "lucide-react"
import { Button } from "../../controls/button"
import { Icon } from "../../primitives/icon"
import { CanvasDirectionControl, type CanvasDirection } from "./canvas-direction-control"

interface CanvasToolbarProps {
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
  /** Folded side nodes: every fold open (then the button folds them) or not. Omit when the graph has none. */
  foldsOpen?: boolean
  onToggleFolds?: () => void
  /** Floats over the canvas's lower right corner (the toolbar of a drawn graph). */
  floating?: boolean
}

/** Words in the toolbar show only on a canvas wide enough for them; a narrow one (a pane open) keeps the icons. */
const COMPACT = "hidden @2xl/canvas:inline"

/** Between groups (zoom · fit · layout · direction · minimap); border-default alone is too faint on the popover surface. */
const Divider = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-neutral/30" />

/** Small canvas controls designed to float along the bottom edge of a graph. */
export function CanvasToolbar({ zoomPercent, onZoomIn, onZoomOut, onFit, onResetZoom, onLayout, minimapVisible, onToggleMinimap, layoutLabel, direction, onDirectionChange, directionDisabled, foldsOpen, onToggleFolds, floating }: CanvasToolbarProps) {
  return <div role="toolbar" aria-label="캔버스 도구" className={floating ? "flex h-9 items-center gap-0.5 rounded-md border border-default bg-overlay px-1 shadow-sm absolute right-3 bottom-3 z-30" : "flex h-9 items-center gap-0.5 rounded-md border border-default bg-overlay px-1 shadow-sm"}>
    <Button variant="ghost" size="icon-xs" aria-label="축소" onClick={onZoomOut}><Minus /></Button>
    {onResetZoom ? (
      <Button variant="ghost" size="xs" className="min-w-10 px-1 text-xs tabular-nums text-muted" aria-label="읽기 크기 100%" title="읽기 크기 100%" onClick={onResetZoom}>{Math.round(zoomPercent)}%</Button>
    ) : (
      <span className="min-w-10 text-center text-xs tabular-nums text-muted">{Math.round(zoomPercent)}%</span>
    )}
    <Button variant="ghost" size="icon-xs" aria-label="확대" onClick={onZoomIn}><Plus /></Button>
    <Divider />
    <Button variant="ghost" size="icon-xs" aria-label="화면에 맞춤" onClick={onFit}><Maximize /></Button>
    {onLayout && <Divider />}
    {onLayout && <Button variant="ghost" size={layoutLabel ? "sm" : "icon-xs"} aria-label={layoutLabel ?? "자동 정렬"} title={layoutLabel ?? "자동 정렬"} onClick={onLayout}><WandSparkles />{layoutLabel && <span className={COMPACT}>{layoutLabel}</span>}</Button>}
    {onToggleFolds && foldsOpen !== undefined && <>
      <Divider />
      <Button variant="ghost" size="sm" aria-label={foldsOpen ? "모두 접기" : "모두 펼치기"} title={foldsOpen ? "접힌 노드를 모두 접기" : "접힌 노드를 모두 펼치기"} onClick={onToggleFolds}>{foldsOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}<span className={COMPACT}>{foldsOpen ? "접기" : "모두 펼치기"}</span></Button>
    </>}
    {direction && onDirectionChange && <>
      <Divider />
      <CanvasDirectionControl direction={direction} onDirectionChange={onDirectionChange} disabled={directionDisabled} variant="ghost" compactLabels />
    </>}
    {onToggleMinimap && minimapVisible !== undefined && <>
      <Divider />
      <Button variant={minimapVisible ? "secondary" : "ghost"} size="icon-xs" aria-label={minimapVisible ? "미니맵 숨기기" : "미니맵 표시"} aria-pressed={minimapVisible} onClick={onToggleMinimap}><Grid2X2 /></Button>
    </>}
  </div>
}

/** Zoom out, zoom in, fit: a bar of three buttons at the canvas's lower right. */
export function FloatingZoomBar({ onZoomOut, onZoomIn, onFit }: { onZoomOut: () => void; onZoomIn: () => void; onFit: () => void }) {
  const button = "rounded-none hover:bg-hover text-muted hover:text-default"
  return (
    <div className="absolute right-3 bottom-3 flex items-center rounded-lg border border-default bg-surface shadow-xs backdrop-blur-md overflow-hidden select-none">
      <Button variant="ghost" size="icon-sm" aria-label="축소" onClick={onZoomOut} className={button}>
        <Icon icon={Minus} size="sm" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="확대" onClick={onZoomIn} className={button}>
        <Icon icon={Plus} size="sm" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="전체 맞춤" onClick={onFit} className={button}>
        <Icon icon={Maximize} size="sm" />
      </Button>
    </div>
  )
}
