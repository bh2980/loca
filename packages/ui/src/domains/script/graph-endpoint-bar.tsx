import { ArrowRight, LocateFixed, RotateCcw, X } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "../../controls/button"
import { Icon } from "../../primitives/icon"
import { Inline } from "../../primitives/stack"
import { cn } from "../../lib/utils"

export type GraphEndpointStep = "start" | "end"
export interface GraphEndpointValue {
  id: string
  label: string
}

/** Shared start/end selection surface for picking a bounded path on the source graph. */
export function GraphEndpointBar({ start, end, step, picking, canFind, busy, status, onStepChange, onBeginPicking, onFind, onClear }: {
  start?: GraphEndpointValue
  end?: GraphEndpointValue
  step: GraphEndpointStep
  picking: boolean
  canFind: boolean
  busy?: boolean
  status?: ReactNode
  onStepChange?: (step: GraphEndpointStep) => void
  onBeginPicking?: (step: GraphEndpointStep) => void
  onFind?: () => void
  onClear?: () => void
}) {
  const endpoint = (which: GraphEndpointStep, value?: GraphEndpointValue) => (
    <Button
      type="button"
      size="sm"
      variant={picking && step === which ? "outline" : "ghost"}
      aria-pressed={picking && step === which}
      title={value?.label}
      aria-label={`${which === "start" ? "시작 대사" : "끝 대사"}${value ? `: ${value.label}` : " 선택 안 됨"}`}
      className={cn("h-7 max-w-xs min-w-0 justify-start gap-1.5 px-2.5 text-xs", picking && step === which && "border-accent bg-accent/5")}
      onClick={() => picking ? onStepChange?.(which) : onBeginPicking?.(which)}
    >
      <span className="shrink-0 font-semibold text-muted">{which === "start" ? "시작" : "끝"}:</span>
      <span className="truncate text-default">{value?.label ?? "그래프에서 선택"}</span>
      {picking && step === which && <LocateFixed className="size-3.5 shrink-0 text-accent" aria-hidden="true" />}
    </Button>
  )

  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-default bg-chrome/40 px-3 py-1" aria-label="경로 끝점">
      {endpoint("start", start)}
      <Icon icon={ArrowRight} size="sm" shrink={false} tone="muted" aria-hidden="true" />
      {endpoint("end", end)}
      <Inline marginLeft="auto" gap="snug">
        {picking ? (
          <>
            <Button size="sm" disabled={!canFind || busy} onClick={onFind}>{busy ? "경로를 찾는 중…" : "경로 만들기"}</Button>
            <Button size="sm" variant="ghost" aria-label={start || end ? "선택 지우기" : "경로 선택 취소"} onClick={onClear}><X className="size-3.5" /> {start || end ? "지우기" : "취소"}</Button>
          </>
        ) : (
          <>
            {status}
            <Button size="sm" variant="outline" onClick={() => onBeginPicking?.("start")}><RotateCcw className="size-3.5" /> 다시 선택</Button>
            <Button size="sm" variant="ghost" aria-label="경로 선택 지우기" onClick={onClear}><X className="size-3.5" /> 지우기</Button>
          </>
        )}
      </Inline>
    </div>
  )
}
