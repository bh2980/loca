import { ArrowDown, ArrowRight } from "lucide-react"
import { SegmentedControl } from "../../controls/segmented-control"

export type CanvasDirection = "vertical" | "horizontal"

/** The words beside the arrows show only on a canvas wide enough for them (`@container/canvas`); a narrow one keeps the arrows. */
const WIDE_CANVAS = "hidden @2xl/canvas:inline"

/** Shared orientation control for graph canvases. `compactLabels`: the words show on a wide canvas only. */
export function CanvasDirectionControl({ direction, onDirectionChange, disabled, compactLabels, variant = "default" }: {
  direction: CanvasDirection
  onDirectionChange: (direction: CanvasDirection) => void
  disabled?: boolean
  compactLabels?: boolean
  variant?: "default" | "ghost"
}) {
  const label = compactLabels ? WIDE_CANVAS : undefined
  return <SegmentedControl
    value={direction}
    onChange={(value) => onDirectionChange(value as CanvasDirection)}
    ariaLabel="그래프 방향"
    disabled={disabled}
    variant={variant}
    items={[
      { value: "horizontal", name: "가로", label: <><ArrowRight aria-hidden="true" /><span className={label}>가로</span></> },
      { value: "vertical", name: "세로", label: <><ArrowDown aria-hidden="true" /><span className={label}>세로</span></> },
    ]}
  />
}
