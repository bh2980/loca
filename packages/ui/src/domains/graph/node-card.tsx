import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Icon } from "../../primitives/icon"
import { AlertCircle, AlertTriangle, RotateCcw } from "lucide-react"
import { cn } from "../../lib/utils"
import type { CanvasDirection } from "./canvas-direction-control"
import { FoldChip, type FoldChipProps } from "./fold-chip"
import { ExitTag, type ExitTagItem } from "./exit-tag"
import { paletteColor } from "../../patterns/palette"

export type NodeCardKind = "entry" | "ai" | "apply" | "status" | "function" | "condition" | "gather" | "call" | "end"

interface NodeCardPort {
  id: string
  label: string
  tone?: "neutral" | "warning" | "destructive"
  handle?: ReactNode
  /** No line leaves this exit: the line stops here (끝), or fails (실패) when it is the error exit. */
  open?: boolean
  /** Nodes that hang off this exit, folded into a chip below (or beside) it; open, the chip is 접기. */
  fold?: FoldChipProps
  /** What this exit does to the lines when no line leaves it (its 출구 동작 then end the line), drawn below (or beside) it. */
  marks?: { items: ExitTagItem[]; onOpen: () => void; selected?: boolean; compact?: boolean }
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
  live?: { queued: number; running: number; failed: number; calls?: number; limit?: number; passed?: number; /** An AI node: the lines its retry rules sent back that wait to be sent again, as a phrase ("다시 보냄 12 · 출력 잘림"). */ retry?: string }
  /** An AI node's retry rules in a few words ("재시도 규칙 2개"), with every rule in `detail` (its tooltip). */
  retry?: { text: string; detail?: string }
  /** An AI node's model, as a chip in its header ("grok-4.7"). */
  badge?: string
  /** A one-line node's verb before its title ("저장", "태그"). */
  verb?: string
  /** A status change's status colour: the dot of its pill. */
  color?: string
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

export const NODE_CARD_KIND_APPEARANCE: Record<NodeCardKind, { label: string; icon: string; header: string; dot: string; border: string; title: string; capsule?: boolean }> = {
  entry: { label: "진입", icon: "text-muted", header: "bg-node-header-neutral text-muted", dot: "bg-neutral", border: "border-default", title: "text-default", capsule: true },
  ai: { label: "AI", icon: "text-ai", header: "bg-node-header-ai text-ai", dot: "bg-ai", border: "border-ai/40", title: "text-ai" },
  // One colour per editor group: AI (보라), 반영 (파랑), 함수 (초록), 흐름 (노랑: 조건, 모으기, 호출);
  // 상태 변경 stands out from the other 반영 nodes in the status hue (분홍), since it moves lines between statuses.
  apply: { label: "반영", icon: "text-accent", header: "bg-node-header-check text-accent", dot: "bg-accent", border: "border-default", title: "text-default" },
  status: { label: "상태 변경", icon: "text-node-state", header: "bg-node-header-state text-node-state", dot: "bg-node-state", border: "border-default", title: "text-default" },
  function: { label: "함수", icon: "text-success", header: "bg-node-header-status text-success", dot: "bg-success", border: "border-success/40", title: "text-success" },
  condition: { label: "조건", icon: "text-review", header: "bg-node-header-flow text-review", dot: "bg-review", border: "border-review/50", title: "text-review" },
  gather: { label: "모으기", icon: "text-review", header: "bg-node-header-flow text-review", dot: "bg-review", border: "border-review/50", title: "text-review" },
  call: { label: "워크플로 호출", icon: "text-review", header: "bg-node-header-flow text-review", dot: "bg-review", border: "border-review/50", title: "text-review" },
  end: { label: "종료", icon: "text-muted", header: "", dot: "bg-neutral", border: "border-default", title: "text-default", capsule: true },
}

const WIDTH = { entry: "w-48", vertical: "w-56", horizontal: "w-72" } as const

/**
 * A workflow node, its shape by what it does: an AI step is a card (a tinted header with its model, what it makes, its
 * retries); a check or a condition is its header alone; a save is one line with its verb; a status change is a pill in
 * its status's colour; the entry and the end are capsules. Exits are the dots on its edge (the handles): no row of exit
 * names, the lines say which is which by their colour.
 */
export function NodeCard({ kind, icon, title, summary, retry, badge, verb, color, inputHandle, outputs = [], errors = 0, warnings = 0, live, parallel, selected, disabled, direction = "vertical", width, start, foldClose }: NodeCardProps) {
  const style = NODE_CARD_KIND_APPEARANCE[kind]
  const hasLive = live && live.queued + live.running + live.failed + (live.passed ?? 0) + (live.retry ? 1 : 0) > 0
  const shape = kind === "apply" ? "line" : kind === "status" || style.capsule ? "pill" : kind === "function" || kind === "condition" ? "header" : "card"
  const issueMark = errors > 0 ? (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-1.5 text-xs font-medium text-danger" title={`${errors}개 오류`}><AlertCircle className="size-3" />{errors}</span>
  ) : warnings > 0 ? (
    <span className="flex shrink-0 items-center gap-1 text-xs text-warning" title={`${warnings}개 주의`}><AlertTriangle className="size-3" />{warnings}</span>
  ) : null
  const liveRow = hasLive && (
    <span className="flex min-w-0 gap-2 text-xs tabular-nums">
      {live.limit !== undefined && (live.calls ?? 0) > 0 && <span className="font-medium text-default" title="동시에 보낸 요청 / 이 노드가 한 번에 보낼 수 있는 요청(동시 처리 수)">요청 {live.calls}/{live.limit}</span>}
      {live.retry && <span className="truncate text-warning">{live.retry}</span>}
      {live.running > 0 && <span className="font-medium text-default">처리 {live.running}</span>}
      {live.queued > 0 && <span className="text-muted">{kind === "gather" ? "기다리는 중" : "대기"} {live.queued}</span>}
      {live.failed > 0 && <span className="text-danger">실패 {live.failed}</span>}
      {(live.passed ?? 0) > 0 && <span className="text-muted" title="이 노드를 지나간 줄 (다시 지나간 줄은 한 번)">지나감 {live.passed}</span>}
    </span>
  )
  const edge = selected ? "border-accent ring-2 ring-accent/30" : errors > 0 ? "border-danger" : style.border

  let body: ReactNode
  if (shape === "line")
    body = (
      <div className={cn("flex min-h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border bg-surface pr-2 shadow-xs", edge)}>
        <span className={cn("w-1 self-stretch", style.dot)} />
        <span className={cn("shrink-0 text-xs font-semibold", style.icon)}>{verb ?? style.label}</span>
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        {issueMark}
        {(liveRow || summary) && <span className="ml-auto min-w-0 shrink truncate text-xs text-muted" title={summary}>{liveRow || summary}</span>}
      </div>
    )
  else if (shape === "pill")
    body = (
      <div className={cn("flex h-7 min-w-0 items-center gap-1.5 rounded-full border bg-surface px-3 shadow-xs", edge)}>
        {kind === "status" ? <span className="size-2 shrink-0 rounded-full" style={{ background: color ? paletteColor(color) : "var(--background-color-node-state)" }} /> : <span className={cn("flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5", style.icon)}>{icon}</span>}
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        {issueMark}
        {liveRow}
      </div>
    )
  else
    body = (
      <div className={cn("flex min-w-0 flex-1 flex-col rounded-md border bg-surface text-default shadow-xs", edge)}>
        <div className={cn("flex min-h-8 items-center gap-1.5 px-2 py-1", shape === "header" ? "flex-1 rounded-[5px]" : cn("rounded-t-[5px] border-b", style.border), style.header)}>
          <span className={cn("flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5", style.icon)}>{icon}</span>
          <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", style.title)}>{title}</span>
          {parallel !== undefined && parallel > 1 && (
            <span className="shrink-0 rounded-sm bg-page/60 px-1 text-xs font-medium tabular-nums text-default" title={`동시 처리 수 ${parallel}: 요청을 ${parallel}개까지 동시에 보냅니다`}>×{parallel}</span>
          )}
          {badge && <span className="max-w-24 shrink-0 truncate rounded-full border border-default bg-surface px-1.5 text-xs text-muted" title={badge}>{badge}</span>}
          {issueMark}
          {shape === "header" && liveRow}
        </div>
        {shape === "card" && (summary || retry || liveRow) && (
          <div className="space-y-0.5 px-2 py-1.5">
            {summary && <p className="truncate text-xs text-muted" title={summary}>{summary}</p>}
            {retry && <p className="flex items-center gap-1 text-xs text-subtle" title={retry.detail}><RotateCcw className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{retry.text}</span></p>}
            {liveRow && <div className="pt-0.5">{liveRow}</div>}
          </div>
        )}
      </div>
    )

  return (
    <div
      className={cn("relative flex w-full overflow-visible", disabled && "opacity-55", width && WIDTH[width], shape === "pill" && "justify-center")}
      title={shape === "header" ? summary : undefined}
    >
      {inputHandle}
      {body}
      {outputs.map((port) => <span key={`${port.id}-handle`}>{port.handle}</span>)}
      {start && <StartMark direction={direction} {...start} />}
      {outputs.map((port, index) => port.fold && <FoldMark key={`${port.id}-fold`} direction={direction} at={(index + 0.5) / outputs.length} {...port.fold} />)}
      {outputs.map((port, index) => !port.fold && port.marks && <ExitMarks key={`${port.id}-marks`} direction={direction} at={(index + 0.5) / outputs.length} label={port.label} tone={port.tone} {...port.marks} />)}
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

/** How long the short line of an exit no line leaves is (the auto layout keeps the same room). */
const END_STEM = 28

/** A line's colour by its exit's tone, as the canvas draws lines. */
const LINE_STROKE = { neutral: "var(--stroke-graph-edge)", warning: "var(--stroke-warning)", destructive: "var(--stroke-danger)" }

/**
 * The end of an exit no line leaves: its own short line in the exit's colour, and the exit's mark at its end (the auto
 * layout keeps that room clear).
 */
function ExitMarks({ direction, at, label, tone = "neutral", ...tag }: { direction: CanvasDirection; at: number; label: string; tone?: NodeCardPort["tone"] } & NonNullable<NodeCardPort["marks"]>) {
  const vertical = direction !== "horizontal"
  return (
    <div
      className={cn("pointer-events-none absolute z-10 flex items-center", vertical ? "top-full -translate-x-1/2 flex-col" : "left-full -translate-y-1/2 flex-row")}
      style={vertical ? { left: `${at * 100}%` } : { top: `${at * 100}%` }}
    >
      <span style={{ background: LINE_STROKE[tone], ...(vertical ? { width: 1.75, height: END_STEM } : { height: 1.75, width: END_STEM }) }} />
      <ExitTag {...tag} exit={label} />
    </div>
  )
}

/** A node's icon in the color of its kind (the same colors as the node on the canvas). */
export function NodeKindIcon({ icon: Glyph, kind }: { icon: LucideIcon; kind: keyof typeof NODE_CARD_KIND_APPEARANCE }) {
  return <Icon icon={Glyph} size="sm" className={NODE_CARD_KIND_APPEARANCE[kind].icon} />
}
