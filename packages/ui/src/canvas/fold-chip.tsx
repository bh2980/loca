import { AlertCircle, AlertTriangle } from "lucide-react"
import { cn } from "../lib/utils"

export interface FoldChipProps {
  /** What is folded, in a few words ("실패 시 절반으로 2번 → 검토 필요"). */
  text: string
  /** The folded nodes are shown: the chip reads 접기 and folds them again. */
  open?: boolean
  /** Validation issues on the folded nodes. */
  errors?: number
  warnings?: number
  /** A run's lines at the folded nodes ("대기 2 · 실패 3"). */
  live?: string
  onToggle: () => void
  className?: string
}

/**
 * Nodes folded into a small dashed tag on the node or line they hang off. Clicking shows them; once shown
 * the chip is just 접기. A mark like the 시작 / 끝 marks, so it stays out of the node's own click and drag.
 */
export function FoldChip({ text, open, errors = 0, warnings = 0, live, onToggle, className }: FoldChipProps) {
  return (
    <button
      type="button"
      aria-expanded={Boolean(open)}
      aria-label={open ? `${text} 접기`.trim() : `${text} 펼치기`}
      title={open ? "다시 접기" : `${text}\n눌러서 펼치기`}
      onClick={(event) => { event.stopPropagation(); onToggle() }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        "nodrag nopan pointer-events-auto flex max-w-56 items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/60 bg-card px-2 py-0.5 text-xs leading-4 text-muted-foreground hover:border-foreground hover:text-foreground",
        errors > 0 && "border-destructive/70",
        className,
      )}
    >
      <span className="min-w-0 truncate">{open ? "접기" : text}</span>
      {!open && live && <span className="shrink-0 tabular-nums text-foreground">· {live}</span>}
      {!open && errors > 0 ? (
        <span className="flex shrink-0 items-center gap-0.5 font-medium text-destructive"><AlertCircle className="size-3" />{errors}</span>
      ) : !open && warnings > 0 ? (
        <span className="flex shrink-0 items-center gap-0.5 text-warning"><AlertTriangle className="size-3" />{warnings}</span>
      ) : null}
    </button>
  )
}
