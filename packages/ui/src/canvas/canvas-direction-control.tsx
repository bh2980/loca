import { ArrowDown, ArrowRight } from "lucide-react"
import { SegmentedControl } from "../layout/segmented-control"

export type CanvasDirection = "vertical" | "horizontal"

/** Shared orientation control for graph canvases. */
export function CanvasDirectionControl({ direction, onDirectionChange, disabled, className, variant = "default" }: {
  direction: CanvasDirection
  onDirectionChange: (direction: CanvasDirection) => void
  disabled?: boolean
  className?: string
  variant?: "default" | "ghost"
}) {
  return <SegmentedControl
    value={direction}
    onChange={(value) => onDirectionChange(value as CanvasDirection)}
    ariaLabel="그래프 방향"
    disabled={disabled}
    className={className}
    variant={variant}
    items={[
      { value: "horizontal", label: <><ArrowRight aria-hidden="true" />가로</> },
      { value: "vertical", label: <><ArrowDown aria-hidden="true" />세로</> },
    ]}
  />
}
