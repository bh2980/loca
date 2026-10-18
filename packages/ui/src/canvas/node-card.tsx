import type { ReactNode } from "react"
import { AlertCircle, AlertTriangle } from "lucide-react"
import { cn } from "../lib/utils"
import type { CanvasDirection } from "./canvas-direction-control"

export type NodeCardKind = "entry" | "ai" | "function" | "condition" | "status" | "end"

export interface NodeCardPort {
  id: string
  label: string
  tone?: "neutral" | "warning" | "destructive"
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
  direction?: CanvasDirection
  className?: string
}

export const NODE_CARD_KIND_APPEARANCE: Record<NodeCardKind, { label: string; icon: string; header: string; dot: string; capsule?: boolean }> = {
  entry: { label: "진입", icon: "text-muted-foreground", header: "bg-node-header-neutral text-muted-foreground", dot: "bg-muted-foreground", capsule: true },
  ai: { label: "AI", icon: "text-ai", header: "bg-node-header-ai text-ai", dot: "bg-ai" },
  function: { label: "검사·작업", icon: "text-primary", header: "bg-node-header-check text-primary", dot: "bg-primary" },
  condition: { label: "조건", icon: "text-review-ink", header: "bg-node-header-flow text-review-ink", dot: "bg-review" },
  status: { label: "상태 변경", icon: "text-success", header: "bg-node-header-status text-success", dot: "bg-success" },
  end: { label: "종료", icon: "text-muted-foreground", header: "", dot: "bg-muted-foreground", capsule: true },
}

/** Compact workflow node shared by graph renderers: capsule for entry/end, chamfered diamond for condition, rounded rectangle for actions. */
export function NodeCard({ kind, icon, title, summary, inputHandle, outputs = [], errors = 0, warnings = 0, live, selected, disabled, direction = "vertical", className }: NodeCardProps) {
  const style = NODE_CARD_KIND_APPEARANCE[kind]
  const hasLive = live && live.queued + live.running + live.failed > 0
  const showType = title.trim() !== style.label
  const isHorizontal = direction === "horizontal"
  const isCondition = kind === "condition"
  const isCapsule = style.capsule

  const content = (
    <>
      <div className={cn("min-w-0 flex-1", isHorizontal ? "flex flex-col justify-center rounded-l-md" : "")}>
        <div className={cn("flex min-h-8 items-center gap-2 px-2.5 py-1.5", isHorizontal ? "rounded-l-md" : "rounded-t-md", isCapsule && (isHorizontal ? "rounded-l-full" : "rounded-t-full"), style.header)}>
          <span className={cn("flex size-6 shrink-0 items-center justify-center [&_svg]:size-3.5", style.icon, isCondition && "rotate-45 rounded-sm bg-card/70 shadow-2xs")}><span className={isCondition ? "-rotate-45" : undefined}>{icon}</span></span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
          {errors > 0 ? (
            <span className="flex shrink-0 items-center gap-1 rounded-sm bg-destructive/10 px-1 text-xs font-medium text-destructive" title={`${errors}개 오류`}>
              <AlertCircle className="size-3" />{errors}
            </span>
          ) : warnings > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-warning" title={`${warnings}개 주의`}><AlertTriangle className="size-3" />{warnings}</span>
          ) : null}
        </div>
        {showType && <div className={cn("px-2.5 pb-1 text-xs font-medium", style.icon)}>{style.label}</div>}
        {summary && <p className={cn("px-2.5 py-1 text-xs text-muted-foreground", isHorizontal ? "line-clamp-2" : "min-h-7 truncate")}>{summary}</p>}
        {hasLive && <div className="flex gap-2 border-t border-border-subtle px-2.5 py-1 text-xs tabular-nums">
          {live.running > 0 && <span className="font-medium text-foreground">처리 {live.running}</span>}
          {live.queued > 0 && <span className="text-muted-foreground">대기 {live.queued}</span>}
          {live.failed > 0 && <span className="text-destructive">실패 {live.failed}</span>}
        </div>}
      </div>
      {outputs.length > 0 && <div className={cn(
        "relative text-xs",
        isHorizontal
          ? cn("grid min-h-full min-w-24 self-stretch grid-cols-1 items-center rounded-r-md border-l border-border bg-muted/40", isCapsule && "rounded-r-full")
          : cn("grid min-h-7 items-center rounded-b-md border-t border-border bg-muted/40", isCapsule && "rounded-b-full"),
      )} style={isHorizontal ? { gridTemplateRows: `repeat(${outputs.length}, minmax(1.25rem, 1fr))` } : { gridTemplateColumns: `repeat(${outputs.length}, minmax(0, 1fr))` }}>
        {outputs.map((port) => <span key={port.id} className={cn(
          "min-w-0 truncate",
          isHorizontal ? "px-2 text-right" : "text-center",
          port.tone === "destructive" && "font-medium text-destructive",
          port.tone === "warning" && "font-medium text-warning",
          port.tone === "neutral" && "text-muted-foreground",
        )} title={port.label}>{port.label}</span>)}
      </div>}
    </>
  )

  return (
    <div className={cn(
      "relative flex w-full overflow-visible",
      isHorizontal ? "min-h-16" : "",
      disabled && "opacity-55",
      className,
    )}>
      {inputHandle}
      {isCondition ? (
        <div
          className={cn(
            "flex min-w-0 flex-1 p-[1.5px] shadow-xs transition-colors",
            isHorizontal ? "flex-row min-h-16" : "flex-col",
            selected ? "bg-primary" : errors > 0 ? "bg-destructive" : "bg-border"
          )}
          style={{ clipPath: "polygon(14px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0 calc(100% - 14px), 0 14px)" }}
        >
          <div
            className={cn("flex min-w-0 flex-1 bg-card text-card-foreground", isHorizontal ? "flex-row min-h-[calc(4rem-3px)]" : "flex-col")}
            style={{ clipPath: "polygon(13px 0, calc(100% - 13px) 0, 100% 13px, 100% calc(100% - 13px), calc(100% - 13px) 100%, 13px 100%, 0 calc(100% - 13px), 0 13px)" }}
          >
            {content}
          </div>
        </div>
      ) : (
        <div className={cn(
          "relative flex min-w-0 flex-1 overflow-visible rounded-md border border-border bg-card text-card-foreground shadow-xs",
          isHorizontal ? "min-h-16 flex-row" : "flex-col",
          isCapsule && (kind === "end" || !isHorizontal ? "rounded-full" : "rounded-l-full"),
          selected && "border-primary ring-1 ring-primary",
          errors > 0 && "border-destructive",
        )}>
          {content}
        </div>
      )}
      {outputs.map((port) => <span key={`${port.id}-handle`}>{port.handle}</span>)}
    </div>
  )
}
