import { Box } from "../../primitives/box"
import { Chip } from "../../patterns/chip"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../controls/tooltip"

export type SeamState = "checked" | "stale"

/** 점검함 / 바뀜 / 미점검: color only where it means something (바뀜 asks for another look). `compact` is the small one on a graph node. */
export function SeamStateChip({ state, compact }: { state: SeamState | undefined; compact?: boolean }) {
  const size = compact ? "compact" : undefined
  if (state === "checked") return <Chip variant="outline" tone="success" soft size={size}>점검함</Chip>
  if (state === "stale") return <Chip variant="outline" tone="warning" soft size={size}>바뀜</Chip>
  return <Chip variant="outline" tone="muted" size={size}>미점검</Chip>
}

/**
 * 'i/n': this starts one of several choices that open at the same place. It is not a story connection, and says so. `spaced` sits after a
 * label; `plain` is the quiet text version inside a fork's pill.
 */
export function ArmChip({ arm, spaced, plain }: { arm: { index: number; count: number }; spaced?: boolean; plain?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Box asChild tabular marginLeft={spaced ? "condensed" : undefined}>
          <Chip variant={plain ? "plain" : "quiet"} data-testid="arm-chip">
            {arm.index}/{arm.count}
          </Chip>
        </Box>
      </TooltipTrigger>
      <TooltipContent>{"함께 열리는 선택지 · 이야기 연결 아님"}</TooltipContent>
    </Tooltip>
  )
}
