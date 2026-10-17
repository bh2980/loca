import type { ReactNode } from "react"
import { cn } from "../lib/utils"

function subject(noun: string) {
  const code = noun.trim().charCodeAt(noun.trim().length - 1) - 0xac00
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? "이" : "가"
}

export interface EmptyStateProps {
  noun: string
  filtered?: boolean
  hint?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({
  noun,
  filtered,
  hint,
  action,
  className,
}: EmptyStateProps) {
  const particle = subject(noun)
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-12 text-center text-xs text-muted-foreground",
        className
      )}
    >
      <p
        className={cn(
          "text-xs",
          !filtered && hint ? "font-medium text-foreground" : undefined
        )}
      >
        {filtered
          ? `조건에 맞는 ${noun}${particle} 없습니다.`
          : `아직 ${noun}${particle} 없습니다.`}
      </p>
      {!filtered && hint && <p className="mt-1 text-muted-foreground/80">{hint}</p>}
      {!filtered && action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}
