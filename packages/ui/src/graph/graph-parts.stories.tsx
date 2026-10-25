import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../layout/box"
import { Inline, Stack } from "../layout/stack"
import { Button } from "../primitives/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../primitives/dropdown-menu"
import { Text } from "../primitives/text"
import { TooltipProvider } from "../primitives/tooltip"
import { CanvasChip, CanvasChipLabel, CanvasChipNote, CanvasToast, ChipDot, FloatingZoomBar, FoundNodeList } from "./canvas-chrome"
import { FloatingCard } from "./floating-card"
import { ColumnResizeHandle, FlowRow, WayChip } from "./flow-pane"
import { ForkOptionItem } from "./fork-menu"
import { ArmChip, SeamStateChip } from "./path-chips"
import { ForkNodeFrame, PathEdgeLabel, PathNodeButton, PathNodeCard } from "./path-node"
import { PersonNodeFrame, RelationLabelFrame } from "./relationship-node"
import { SearchResultButton } from "./search-result"

const meta = { title: "Graph/Graph parts", decorators: [(Story) => <TooltipProvider><Box style={{ width: 420 }}><Story /></Box></TooltipProvider>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const ForkMenu: Story = {
  render: () => (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild><Button variant="outline">갈림길 1</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <ForkOptionItem label="문을 연다" preview="문고리가 차갑다." selected onSelect={() => {}} />
        <ForkOptionItem label="돌아선다" preview="돌아서서 걷는다." selected={false} onSelect={() => {}} />
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const SearchResults: Story = {
  render: () => (
    <Box border="all" borderColor="border" radius="md" background="card" overflow="hidden">
      <SearchResultButton><Text width="full" truncate weight="medium">하윤: …여기 있었구나.</Text><Text variant="caption" tone="muted">12-001 · 그래프에서 위치 찾기</Text></SearchResultButton>
      <SearchResultButton><Text width="full" truncate weight="medium">지문: 문이 닫힌다.</Text><Text variant="caption" tone="muted">12-002 · 그래프에서 위치 찾기</Text></SearchResultButton>
    </Box>
  ),
}

export const LineCard: Story = {
  render: () => (
    <FloatingCard tabIndex={-1}>
      <Text variant="label">하윤</Text>
      <Text variant="body">…여기 있었구나.</Text>
    </FloatingCard>
  ),
}

export const FlowRows: Story = {
  render: () => {
    const [width, setWidth] = useState(72)
    const style = { gridTemplateColumns: `${width}px minmax(0,1fr)` }
    return (
      <Box position="relative" border="all">
        <Inline as="p" wrap gap="tight" background="muted" paddingX="comfortable" paddingY="snug" variant="caption" tone="muted">
          <WayChip choice>▶ 문을 연다</WayChip>
          <WayChip>조건: 열쇠</WayChip>
        </Inline>
        <ol>
          <FlowRow who="하윤" what="…여기 있었구나." style={style} />
          <FlowRow who="하윤" what="…여기 있었구나." editable editing tabIndex={0} style={style} />
          <FlowRow who="선택지" what={<Text as="p" weight="medium" tone="choice">▶ 문을 연다</Text>} tint="choice" editable tabIndex={0} style={style} />
          <FlowRow who="이벤트" what={<Text tone="muted">화면 흔들림</Text>} tint="muted" style={style} />
        </ol>
        <ColumnResizeHandle aria-label="화자 칸 폭" style={{ left: width + 18 }} onDoubleClick={() => setWidth(72)} />
      </Box>
    )
  },
}

export const PathNodes: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline gap="condensed">
        <SeamStateChip state="checked" /><SeamStateChip state="stale" /><SeamStateChip state={undefined} /><SeamStateChip state="stale" compact />
        <ArmChip arm={{ index: 1, count: 3 }} />
      </Inline>
      <PathNodeCard here selected style={{ width: 260, height: 76 }}>
        <Text variant="caption" tone="muted">하윤</Text>
        <Text as="p" lines={2} variant="body" leading="snug">…여기 있었구나.</Text>
      </PathNodeCard>
      <ForkNodeFrame selected style={{ width: 130, height: 28 }}>
        <Inline height={7} width="full" justify="center" gap="tight" radius="full" border="all" background="muted" paddingX="condensed" variant="caption" nowrap tone="muted">조건 <ArmChip arm={{ index: 2, count: 3 }} plain /></Inline>
      </ForkNodeFrame>
      <Box style={{ width: 260, height: 36 }}><PathNodeButton>번역함 · 12줄 <ArmChip arm={{ index: 1, count: 2 }} spaced /></PathNodeButton></Box>
      <Box style={{ width: 56, height: 28 }}><PathNodeButton round>…</PathNodeButton></Box>
      <Box position="relative" style={{ height: 28 }}><PathEdgeLabel style={{ width: 200 }}>이음새 <SeamStateChip state="checked" compact /></PathEdgeLabel></Box>
    </Stack>
  ),
}

export const RelationshipNodes: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline gap="condensed">
        <PersonNodeFrame role="main" style={{ width: 120, height: 36 }}>하윤</PersonNodeFrame>
        <PersonNodeFrame style={{ width: 120, height: 36 }} active>도현</PersonNodeFrame>
        <PersonNodeFrame role="minor" style={{ width: 120, height: 36 }} dim>행인</PersonNodeFrame>
      </Inline>
      <Box position="relative" style={{ height: 60 }}>
        <RelationLabelFrame active style={{ position: "static" }}>
          <Button variant="ghost" size="inline" justifyContent="start" radius="none" weight="medium" nowrap tone="primary">하윤 → 도현 · 친구</Button>
          <Button variant="ghost" size="inline" justifyContent="start" radius="none" weight="normal" nowrap tone="primary">도현 → 하윤 · 동료</Button>
        </RelationLabelFrame>
      </Box>
    </Stack>
  ),
}

export const CanvasChrome: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <CanvasChipNote>노드 3개 선택</CanvasChipNote>
      <CanvasChip kind="actions"><span>보기 "올렉 사망 분기" · 남김 12</span><Button variant="ghost">보기</Button></CanvasChip>
      <CanvasChip kind="actions"><ChipDot /><span>강조 "인사" · 이 화면 4 / 5개</span><Button variant="ghost">강조 해제</Button></CanvasChip>
      <CanvasChipLabel>장면 경유 연결 7</CanvasChipLabel>
      <Box position="relative" style={{ height: 120, width: 320 }}>
        <FoundNodeList>
          <li><SearchResultButton><Text width="full" truncate weight="medium">하윤: …</Text></SearchResultButton></li>
        </FoundNodeList>
      </Box>
      <Box position="relative" style={{ height: 80, width: 320 }}>
        <CanvasToast role="status">바뀐 내용으로 다시 배치하는 중…</CanvasToast>
        <FloatingZoomBar onZoomOut={() => {}} onZoomIn={() => {}} onFit={() => {}} />
      </Box>
    </Stack>
  ),
}
