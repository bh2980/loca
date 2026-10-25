import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Icon } from "../../primitives/icon"
import { AlertCircle, AlertTriangle } from "lucide-react"
import { cn } from "../../lib/utils"
import type { CanvasDirection } from "./canvas-direction-control"
import { FoldChip, type FoldChipProps } from "./fold-chip"

export type NodeCardKind = "entry" | "ai" | "apply" | "status" | "function" | "condition" | "gather" | "retry" | "call" | "end"

interface NodeCardPort {
  id: string
  label: string
  tone?: "neutral" | "warning" | "destructive"
  handle?: ReactNode
  /** No line leaves this exit: the line stops here (끝), or fails (실패) when it is the error exit. */
  open?: boolean
  /** Nodes that hang off this exit, folded into a chip below (or beside) it; open, the chip is 접기. */
  fold?: FoldChipProps
}

interface NodeCardProps {
  kind: NodeCardKind
  icon: ReactNode
  title: string
  summary?: string
  inputHandle?: ReactNode
  outputs?: NodeCardPort[]
  errors?: number
  warnings?: number
  /** Lines waiting, being worked on and failed here; `calls`/`limit`: requests in flight and how many can be at once; `passed`: lines that went through (a run's graph). */
  live?: { queued: number; running: number; failed: number; calls?: number; limit?: number; passed?: number; /** A 재요청 node: the lines it sent back that wait to be sent again, as a phrase ("다시 보냄 12 · 출력 잘림"). */ retry?: string }
  /** An AI node's 동시 처리 수: shown as ×n when it sends more than one request at once. */
  parallel?: number
  selected?: boolean
  disabled?: boolean
  direction?: CanvasDirection
  /** A fixed width: the entry card (12rem), a card in a vertical flow (14rem), one in a horizontal flow (18rem). The card is as wide as its parent by default. */
  width?: "entry" | "vertical" | "horizontal"
  /** Lines start here: a 시작 mark before the input, which opens the start settings when given a handler. */
  start?: { label?: string; onOpen?: () => void }
  /** This node is folded away when closed (a tag node on a line): a small 접기 above it folds it back. */
  foldClose?: () => void
}

export const NODE_CARD_KIND_APPEARANCE: Record<NodeCardKind, { label: string; icon: string; header: string; dot: string; capsule?: boolean }> = {
  entry: { label: "진입", icon: "text-muted", header: "bg-node-header-neutral text-muted", dot: "bg-neutral", capsule: true },
  ai: { label: "AI", icon: "text-ai", header: "bg-node-header-ai text-ai", dot: "bg-ai" },
  // One colour per editor group: AI (보라), 반영 (파랑), 함수 (초록), 흐름 (노랑: 조건, 모으기, 재요청);
  // 상태 변경 stands out from the other 반영 nodes in the status hue (분홍), since it moves lines between statuses.
  apply: { label: "반영", icon: "text-accent", header: "bg-node-header-check text-accent", dot: "bg-accent" },
  status: { label: "상태 변경", icon: "text-node-state", header: "bg-node-header-state text-node-state", dot: "bg-node-state" },
  function: { label: "함수", icon: "text-success", header: "bg-node-header-status text-success", dot: "bg-success" },
  condition: { label: "조건", icon: "text-review", header: "bg-node-header-flow text-review", dot: "bg-review" },
  gather: { label: "모으기", icon: "text-review", header: "bg-node-header-flow text-review", dot: "bg-review" },
  retry: { label: "재요청", icon: "text-review", header: "bg-node-header-flow text-review", dot: "bg-review" },
  call: { label: "워크플로 호출", icon: "text-review", header: "bg-node-header-flow text-review", dot: "bg-review" },
  end: { label: "종료", icon: "text-muted", header: "", dot: "bg-neutral", capsule: true },
}

const WIDTH = { entry: "w-48", vertical: "w-56", horizontal: "w-72" } as const

/** Compact workflow node shared by graph renderers: capsule for entry/end, chamfered diamond for condition, rounded rectangle for actions. */
export function NodeCard({ kind, icon, title, summary, inputHandle, outputs = [], errors = 0, warnings = 0, live, parallel, selected, disabled, direction = "vertical", width, start, foldClose }: NodeCardProps) {
  const style = NODE_CARD_KIND_APPEARANCE[kind]
  const hasLive = live && live.queued + live.running + live.failed + (live.passed ?? 0) + (live.retry ? 1 : 0) > 0
  const isHorizontal = direction === "horizontal"
  const isCondition = kind === "condition"
  const isCapsule = style.capsule

  const content = (
    <>
      <div className={cn("min-w-0 flex-1", isHorizontal ? "flex flex-col justify-center" : "")}>
        <div className={cn(
          "flex min-h-8 items-center gap-2 px-2 py-2",
          isHorizontal
            ? cn("rounded-tl-md rounded-tr-none rounded-b-none", isCapsule && "rounded-tl-full")
            : cn("rounded-t-md rounded-b-none", isCapsule && "rounded-t-full"),
          isCondition && "border-b border-review/30",
          style.header
        )}>
          {/* The header colour already tells the group; the icon stays small and plain for every kind. */}
          <span className={cn("flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5", style.icon)}>{icon}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
          {parallel !== undefined && parallel > 1 && (
            <span className="shrink-0 rounded-sm bg-page/60 px-1 text-xs font-medium tabular-nums text-default" title={`동시 처리 수 ${parallel}: 요청을 ${parallel}개까지 동시에 보냅니다`}>×{parallel}</span>
          )}
          {errors > 0 ? (
            <span className="flex shrink-0 items-center gap-1 rounded-sm bg-danger/10 px-1 text-xs font-medium text-danger" title={`${errors}개 오류`}>
              <AlertCircle className="size-3" />{errors}
            </span>
          ) : warnings > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-warning" title={`${warnings}개 주의`}><AlertTriangle className="size-3" />{warnings}</span>
          ) : null}
        </div>
        {summary && <p className={cn("px-2 py-2 text-xs text-muted", isHorizontal ? "line-clamp-2" : "min-h-7 truncate")}>{summary}</p>}
        {hasLive && <div className="flex gap-2 border-t border-subtle px-2 py-1 text-xs tabular-nums">
          {live.limit !== undefined && (live.calls ?? 0) > 0 && <span className="font-medium text-default" title="동시에 보낸 요청 / 이 노드가 한 번에 보낼 수 있는 요청(동시 처리 수)">요청 {live.calls}/{live.limit}</span>}
          {live.retry && <span className="text-warning">{live.retry}</span>}
          {live.running > 0 && <span className="font-medium text-default">처리 {live.running}</span>}
          {live.queued > 0 && <span className="text-muted">{kind === "gather" ? "기다리는 중" : "대기"} {live.queued}</span>}
          {live.failed > 0 && <span className="text-danger">실패 {live.failed}</span>}
          {(live.passed ?? 0) > 0 && <span className="text-muted" title="이 노드를 지나간 줄 (다시 지나간 줄은 한 번)">지나감 {live.passed}</span>}
        </div>}
      </div>
      {outputs.length > 0 && <div className={cn(
        "relative text-xs",
        isHorizontal
          ? cn(
              "grid min-h-full min-w-10 w-10 shrink-0 self-stretch grid-cols-1 items-center rounded-r-md",
              isCondition ? "border-l border-review/30 bg-review/10" : "border-l border-default bg-sunken/40",
              isCapsule && "rounded-r-full"
            )
          : cn(
              "grid min-h-7 items-center rounded-b-md border-t",
              isCondition ? "border-review/30 bg-review/10" : "border-default bg-sunken/40",
              isCapsule && "rounded-b-full"
            ),
      )} style={isHorizontal ? { gridTemplateRows: `repeat(${outputs.length}, minmax(1.25rem, 1fr))` } : { gridTemplateColumns: `repeat(${outputs.length}, minmax(0, 1fr))` }}>
        {outputs.map((port) => <span key={port.id} className={cn(
          "min-w-0 truncate",
          isHorizontal ? "px-1 text-center font-medium" : "text-center",
          port.tone === "destructive" && "text-danger font-semibold",
          port.tone === "warning" && "text-warning font-semibold",
          port.tone === "neutral" && (isCondition ? "text-success font-semibold" : "text-muted"),
        )} title={port.label}>{port.label}</span>)}
      </div>}
    </>
  )

  return (
    <div className={cn(
      "relative flex w-full overflow-visible",
      isHorizontal ? "min-h-16" : "",
      disabled && "opacity-55",
      width && WIDTH[width],
    )}>
      {inputHandle}
      <div className={cn(
        "relative flex min-w-0 flex-1 overflow-visible rounded-md border bg-surface text-default shadow-xs",
        isCondition
          ? selected
            ? "border-accent ring-2 ring-accent/40"
            : errors > 0
              ? "border-danger"
              : "border-review/70"
          : selected
            ? "border-accent ring-1 ring-accent"
            : errors > 0
              ? "border-danger"
              : "border-default",
        isHorizontal ? "min-h-16 flex-row" : "flex-col",
        isCapsule && (kind === "end" || !isHorizontal ? "rounded-full" : "rounded-l-full"),
      )}>
        {content}
      </div>
      {outputs.map((port) => <span key={`${port.id}-handle`}>{port.handle}</span>)}
      {start && <StartMark direction={direction} {...start} />}
      {outputs.map((port, index) => port.fold && <FoldMark key={`${port.id}-fold`} direction={direction} at={(index + 0.5) / outputs.length} {...port.fold} />)}
      {foldClose && <div className="absolute bottom-full right-0 mb-1"><FoldChip text="" open onToggle={foldClose} /></div>}
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
        className="max-w-48 truncate rounded-full border border-default bg-surface px-2 py-0.5 text-xs font-medium text-muted shadow-xs hover:text-default"
      >
        {label}
      </button>
      <span className={cn("bg-neutral/50", vertical ? "h-4 w-px" : "h-px w-4")} />
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
      <span className={cn(failed ? "bg-danger/60" : "bg-neutral/50", vertical ? "h-3 w-px" : "h-px w-3")} />
      <span className={cn("text-xs", failed ? "text-danger" : "text-muted")}>{failed ? "실패" : "끝"}</span>
    </div>
  )
}

/** A fold chip under an exit (beside it when the graph runs sideways), joined to the exit by a short line. */
function FoldMark({ direction, at, ...chip }: { direction: CanvasDirection; at: number } & FoldChipProps) {
  const vertical = direction !== "horizontal"
  return (
    <div
      className={cn("absolute flex items-center", vertical ? "top-full flex-col items-start" : "left-full -translate-y-1/2 flex-row")}
      style={vertical ? { left: `calc(${at * 100}% - 0.125rem)` } : { top: `${at * 100}%` }}
    >
      <span className={cn("bg-neutral/50", vertical ? "ml-0.5 h-2 w-px" : "h-px w-3")} />
      <FoldChip {...chip} />
    </div>
  )
}

/** A node's icon in the color of its kind (the same colors as the node on the canvas). */
export function NodeKindIcon({ icon: Glyph, kind }: { icon: LucideIcon; kind: keyof typeof NODE_CARD_KIND_APPEARANCE }) {
  return <Icon icon={Glyph} size="sm" className={NODE_CARD_KIND_APPEARANCE[kind].icon} />
}
