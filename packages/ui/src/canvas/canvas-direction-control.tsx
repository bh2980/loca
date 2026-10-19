import { ArrowDown, ArrowRight } from "lucide-react"
import { SegmentedControl } from "../layout/segmented-control"

export type CanvasDirection = "vertical" | "horizontal"

/** Shared orientation control for graph canvases. */
export function CanvasDirectionControl({ direction, onDirectionChange, disabled, className, labelClassName, variant = "default" }: {
  direction: CanvasDirection
  onDirectionChange: (direction: CanvasDirection) => void
  disabled?: boolean
  className?: string
  /** Classes for the words beside the arrows (a narrow canvas keeps only the arrows). */
  labelClassName?: string
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
      { value: "horizontal", name: "가로", label: <><ArrowRight aria-hidden="true" /><span className={labelClassName}>가로</span></> },
      { value: "vertical", name: "세로", label: <><ArrowDown aria-hidden="true" /><span className={labelClassName}>세로</span></> },
    ]}
  />
}
