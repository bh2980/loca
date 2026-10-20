import type { ReactNode } from "react"
import { AlertCircle, AlertTriangle } from "lucide-react"
import { cn } from "../lib/utils"
import type { CanvasDirection } from "./canvas-direction-control"

export type NodeCardKind = "entry" | "ai" | "function" | "condition" | "gather" | "status" | "end"

export interface NodeCardPort {
  id: string
  label: string
  tone?: "neutral" | "warning" | "destructive"
  handle?: ReactNode
  /** No line leaves this exit: the line stops here (끝), or fails (실패) when it is the error exit. */
  open?: boolean
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
  /** Lines waiting, being worked on and failed here; `calls`/`limit`: requests in flight and how many can be at once. */
  live?: { queued: number; running: number; failed: number; calls?: number; limit?: number }
  selected?: boolean
  disabled?: boolean
  direction?: CanvasDirection
  className?: string
  /** Lines start here: a 시작 mark before the input, which opens the start settings when given a handler. */
  start?: { label?: string; onOpen?: () => void }
}

export const NODE_CARD_KIND_APPEARANCE: Record<NodeCardKind, { label: string; icon: string; header: string; dot: string; capsule?: boolean }> = {
  entry: { label: "진입", icon: "text-muted-foreground", header: "bg-node-header-neutral text-muted-foreground", dot: "bg-muted-foreground", capsule: true },
  ai: { label: "AI", icon: "text-ai", header: "bg-node-header-ai text-ai", dot: "bg-ai" },
  function: { label: "함수", icon: "text-primary", header: "bg-node-header-check text-primary", dot: "bg-primary" },
  condition: { label: "조건", icon: "text-review-ink", header: "bg-node-header-flow text-review-ink", dot: "bg-review" },
  gather: { label: "모으기", icon: "text-primary", header: "bg-node-header-flow text-primary", dot: "bg-primary" },
  status: { label: "상태 변경", icon: "text-success", header: "bg-node-header-status text-success", dot: "bg-success" },
  end: { label: "종료", icon: "text-muted-foreground", header: "", dot: "bg-muted-foreground", capsule: true },
}

/** Compact workflow node shared by graph renderers: capsule for entry/end, chamfered diamond for condition, rounded rectangle for actions. */
export function NodeCard({ kind, icon, title, summary, inputHandle, outputs = [], errors = 0, warnings = 0, live, selected, disabled, direction = "vertical", className, start }: NodeCardProps) {
  const style = NODE_CARD_KIND_APPEARANCE[kind]
  const hasLive = live && live.queued + live.running + live.failed > 0
  const isHorizontal = direction === "horizontal"
  const isCondition = kind === "condition"
  const isCapsule = style.capsule

  const content = (
    <>
      <div className={cn("min-w-0 flex-1", isHorizontal ? "flex flex-col justify-center" : "")}>
        <div className={cn(
          "flex min-h-8 items-center gap-2 px-2.5 py-1.5",
          isHorizontal
            ? cn("rounded-tl-md rounded-tr-none rounded-b-none", isCapsule && "rounded-tl-full")
            : cn("rounded-t-md rounded-b-none", isCapsule && "rounded-t-full"),
          isCondition && "border-b border-review/30",
          style.header
        )}>
          <span className={cn(
            "flex size-6 shrink-0 items-center justify-center [&_svg]:size-3.5",
            isCondition ? "rotate-45 rounded-xs bg-review text-background shadow-xs" : style.icon
          )}>
            <span className={isCondition ? "-rotate-45 [&_svg]:size-3.5 [&_svg]:stroke-[2]" : undefined}>{icon}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
          {errors > 0 ? (
            <span className="flex shrink-0 items-center gap-1 rounded-sm bg-destructive/10 px-1 text-xs font-medium text-destructive" title={`${errors}개 오류`}>
              <AlertCircle className="size-3" />{errors}
            </span>
          ) : warnings > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-warning" title={`${warnings}개 주의`}><AlertTriangle className="size-3" />{warnings}</span>
          ) : null}
        </div>
        {summary && <p className={cn("px-2.5 py-1.5 text-xs text-muted-foreground", isHorizontal ? "line-clamp-2" : "min-h-7 truncate")}>{summary}</p>}
        {hasLive && <div className="flex gap-2 border-t border-border-subtle px-2.5 py-1 text-xs tabular-nums">
          {live.limit !== undefined && (live.calls ?? 0) > 0 && <span className="font-medium text-foreground" title="동시에 보낸 요청 / 이 노드가 한 번에 보낼 수 있는 요청(연결의 동시 호출 한도)">요청 {live.calls}/{live.limit}</span>}
          {live.running > 0 && <span className="font-medium text-foreground">처리 {live.running}</span>}
          {live.queued > 0 && <span className="text-muted-foreground">{kind === "gather" ? "기다리는 중" : "대기"} {live.queued}</span>}
          {live.failed > 0 && <span className="text-destructive">실패 {live.failed}</span>}
        </div>}
      </div>
      {outputs.length > 0 && <div className={cn(
        "relative text-xs",
        isHorizontal
          ? cn(
              "grid min-h-full min-w-10 w-10 shrink-0 self-stretch grid-cols-1 items-center rounded-r-md",
              isCondition ? "border-l border-review/30 bg-review/10" : "border-l border-border bg-muted/40",
              isCapsule && "rounded-r-full"
            )
          : cn(
              "grid min-h-7 items-center rounded-b-md border-t",
              isCondition ? "border-review/30 bg-review/10" : "border-border bg-muted/40",
              isCapsule && "rounded-b-full"
            ),
      )} style={isHorizontal ? { gridTemplateRows: `repeat(${outputs.length}, minmax(1.25rem, 1fr))` } : { gridTemplateColumns: `repeat(${outputs.length}, minmax(0, 1fr))` }}>
        {outputs.map((port) => <span key={port.id} className={cn(
          "min-w-0 truncate",
          isHorizontal ? "px-1 text-center font-medium" : "text-center",
          port.tone === "destructive" && "text-destructive font-semibold",
          port.tone === "warning" && "text-warning font-semibold",
          port.tone === "neutral" && (isCondition ? "text-success font-semibold" : "text-muted-foreground"),
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
      <div className={cn(
        "relative flex min-w-0 flex-1 overflow-visible rounded-md border bg-card text-card-foreground shadow-xs",
        isCondition
          ? selected
            ? "border-primary ring-2 ring-primary/40"
            : errors > 0
              ? "border-destructive"
              : "border-review/70"
          : selected
            ? "border-primary ring-1 ring-primary"
            : errors > 0
              ? "border-destructive"
              : "border-border",
        isHorizontal ? "min-h-16 flex-row" : "flex-col",
        isCapsule && (kind === "end" || !isHorizontal ? "rounded-full" : "rounded-l-full"),
      )}>
        {content}
      </div>
      {outputs.map((port) => <span key={`${port.id}-handle`}>{port.handle}</span>)}
      {start && <StartMark direction={direction} {...start} />}
      {outputs.map((port, index) => port.open && <EndMark key={`${port.id}-end`} direction={direction} at={(index + 0.5) / outputs.length} failed={port.tone === "destructive"} />)}
    </div>
  )
}

/** Marks, not nodes: where lines enter the workflow and where they stop. They sit outside the card, beside the handles. */
function StartMark({ direction, label = "시작", onOpen }: { direction: CanvasDirection; label?: string; onOpen?: () => void }) {
  const vertical = direction !== "horizontal"
  return (
    <div className={cn("nodrag nopan absolute flex items-center", vertical ? "bottom-full left-1/2 -translate-x-1/2 flex-col" : "right-full top-1/2 -translate-y-1/2 flex-row")}>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onOpen?.() }}
        className="max-w-48 truncate rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-xs hover:text-foreground"
      >
        {label}
      </button>
      <span className={cn("bg-muted-foreground/50", vertical ? "h-4 w-px" : "h-px w-4")} />
    </div>
  )
}

function EndMark({ direction, at, failed }: { direction: CanvasDirection; at: number; failed: boolean }) {
  const vertical = direction !== "horizontal"
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute flex items-center gap-0", vertical ? "top-full -translate-x-1/2 flex-col" : "left-full -translate-y-1/2 flex-row")}
      style={vertical ? { left: `${at * 100}%` } : { top: `${at * 100}%` }}
    >
      <span className={cn(failed ? "bg-destructive/60" : "bg-muted-foreground/50", vertical ? "h-3 w-px" : "h-px w-3")} />
      <span className={cn("text-xs", failed ? "text-destructive" : "text-muted-foreground")}>{failed ? "실패" : "끝"}</span>
    </div>
  )
}
