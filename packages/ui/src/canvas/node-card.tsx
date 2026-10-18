import type { ReactNode } from "react"
import { AlertCircle, AlertTriangle } from "lucide-react"
import { cn } from "../lib/utils"

export type NodeCardKind = "entry" | "ai" | "function" | "condition" | "status" | "end"

export interface NodeCardPort {
  id: string
  label: string
  negative?: boolean
  handle?: ReactNode
}

export interface NodeCardProps {
  kind: NodeCardKind
  icon: ReactNode
  title: string
  summary?: string
  inputHandle?: ReactNode
  outputs?: NodeCardPort[]
  errors?: number
  warnings?: number
  live?: { queued: number; running: number; failed: number }
  selected?: boolean
  disabled?: boolean
  className?: string
}

const kindStyle: Record<NodeCardKind, { icon: string; header: string }> = {
  entry: { icon: "text-muted-foreground", header: "dark:bg-muted" },
  ai: { icon: "text-ai", header: "dark:bg-node-header-ai" },
  function: { icon: "text-primary", header: "dark:bg-node-header-check" },
  condition: { icon: "text-review-ink", header: "dark:bg-node-header-flow" },
  status: { icon: "text-success", header: "dark:bg-node-header-status" },
  end: { icon: "text-muted-foreground", header: "dark:bg-muted" },
}

/** Compact, rectangular workflow node shared by graph renderers. */
export function NodeCard({ kind, icon, title, summary, inputHandle, outputs = [], errors = 0, warnings = 0, live, selected, disabled, className }: NodeCardProps) {
  const style = kindStyle[kind]
  const hasLive = live && live.queued + live.running + live.failed > 0
  return (
    <div className={cn(
      "relative w-56 overflow-visible rounded-md border border-border bg-card text-card-foreground shadow-xs",
      selected && "border-primary ring-1 ring-primary",
      errors > 0 && "border-destructive",
      disabled && "opacity-55",
      className,
    )}>
      {inputHandle}
      <div className={cn("flex min-h-8 items-center gap-2 rounded-t-md px-2.5 py-1.5", style.header)}>
        <span className={cn("flex shrink-0 [&_svg]:size-3.5", style.icon)}>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        {errors > 0 ? (
          <span className="flex shrink-0 items-center gap-1 rounded-sm bg-destructive/10 px-1 text-xs font-medium text-destructive" title={`${errors}개 오류`}>
            <AlertCircle className="size-3" />{errors}
          </span>
        ) : warnings > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-warning" title={`${warnings}개 주의`}><AlertTriangle className="size-3" />{warnings}</span>
        ) : null}
      </div>
      {summary && <p className="min-h-7 truncate px-2.5 py-1 text-xs text-muted-foreground">{summary}</p>}
      {hasLive && <div className="flex gap-2 border-t border-border-subtle px-2.5 py-1 text-xs tabular-nums">
        {live.running > 0 && <span className="font-medium text-foreground">처리 {live.running}</span>}
        {live.queued > 0 && <span className="text-muted-foreground">대기 {live.queued}</span>}
        {live.failed > 0 && <span className="text-destructive">실패 {live.failed}</span>}
      </div>}
      {outputs.map((port) => <span key={port.id} title={port.label} aria-label={port.label}>{port.handle}</span>)}
    </div>
  )
}
