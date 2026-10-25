import { Badge } from "../primitives/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip"
import { cn } from "../lib/utils"

export type SeamState = "checked" | "stale"

/** 점검함 / 바뀜 / 미점검: color only where it means something (바뀜 asks for another look). `compact` is the small one on a graph node. */
export function SeamStateChip({ state, compact }: { state: SeamState | undefined; compact?: boolean }) {
  const size = compact && "h-4 px-1.5 text-xs"
  if (state === "checked") return <Badge variant="outline" className={cn("border-success/40 text-success", size)}>점검함</Badge>
  if (state === "stale") return <Badge variant="outline" className={cn("border-warning/40 text-warning", size)}>바뀜</Badge>
  return <Badge variant="outline" className={cn("text-muted-foreground", size)}>미점검</Badge>
}

/**
 * 'i/n': this starts one of several choices that open at the same place. It is not a story connection, and says so. `spaced` sits after a
 * label; `plain` is the quiet text version inside a fork's pill.
 */
export function ArmChip({ arm, spaced, plain }: { arm: { index: number; count: number }; spaced?: boolean; plain?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className={cn("shrink-0 tabular-nums", spaced && "ml-2", plain && "h-auto border-0 bg-transparent px-0 font-normal text-muted-foreground")} data-testid="arm-chip">
          {arm.index}/{arm.count}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{"함께 열리는 선택지 · 이야기 연결 아님"}</TooltipContent>
    </Tooltip>
  )
}
