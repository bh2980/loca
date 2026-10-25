import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../../primitives/box"
import { Inline, Stack } from "../../primitives/stack"
import { Button } from "../../controls/button"
import { Chip } from "../../patterns/chip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../controls/dropdown-menu"
import { Text } from "../../primitives/text"
import { TooltipProvider } from "../../controls/tooltip"
import { Notice } from "../../patterns/notice"
import { FoundNodeList } from "./canvas-surface"
import { FloatingZoomBar } from "./canvas-toolbar"
import { FloatingCard } from "./floating-card"
import { ColumnResizeHandle, FlowRow } from "./flow-pane"
import { ForkOptionItem } from "./fork-menu"
import { ArmChip, SeamStateChip } from "./path-chips"
import { ForkNodeFrame, PathEdgeLabel, PathNodeButton, PathNodeCard } from "./path-node"
import { PersonNodeFrame, RelationLabelFrame } from "./relationship-node"
import { ListRow } from "../../patterns/list-row"

const meta = { title: "Domains/Graph/Path and relationship parts", decorators: [(Story) => <TooltipProvider><Box style={{ width: 420 }}><Story /></Box></TooltipProvider>] } satisfies Meta
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
    <Box border="all" borderColor="default" radius="md" background="surface" overflow="hidden">
      <ListRow as="button"><Text width="full" truncate weight="medium">하윤: …여기 있었구나.</Text><Text variant="caption" tone="muted">12-001 · 그래프에서 위치 찾기</Text></ListRow>
      <ListRow as="button"><Text width="full" truncate weight="medium">지문: 문이 닫힌다.</Text><Text variant="caption" tone="muted">12-002 · 그래프에서 위치 찾기</Text></ListRow>
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
        <Inline as="p" wrap gap="tight" background="sunken" paddingX="comfortable" paddingY="condensed" variant="caption" tone="muted">
          <Chip variant="pill" tone="choice">▶ 문을 연다</Chip>
          <Chip variant="pill">조건: 열쇠</Chip>
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
        <Inline height="control-sm" width="full" justify="center" gap="tight" radius="full" border="all" background="sunken" paddingX="condensed" variant="caption" nowrap tone="muted">조건 <ArmChip arm={{ index: 2, count: 3 }} plain /></Inline>
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
          <Button variant="ghost" size="inline" justifyContent="start" radius="none" weight="medium" nowrap tone="accent">하윤 → 도현 · 친구</Button>
          <Button variant="ghost" size="inline" justifyContent="start" radius="none" weight="normal" nowrap tone="accent">도현 → 하윤 · 동료</Button>
        </RelationLabelFrame>
      </Box>
    </Stack>
  ),
}

export const CanvasChrome: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <Chip as="p" variant="note">노드 3개 선택</Chip>
      <Chip as="div" variant="bar" removable><span>보기 "올렉 사망 분기" · 남김 12</span><Button variant="ghost">보기</Button></Chip>
      <Chip as="div" variant="bar" removable><Chip.Dot /><span>강조 "인사" · 이 화면 4 / 5개</span><Button variant="ghost">강조 해제</Button></Chip>
      <Chip as="label" variant="bar" tone="muted">장면 경유 연결 7</Chip>
      <Box position="relative" style={{ height: 120, width: 320 }}>
        <FoundNodeList>
          <li><ListRow as="button"><Text width="full" truncate weight="medium">하윤: …</Text></ListRow></li>
        </FoundNodeList>
      </Box>
      <Box position="relative" style={{ height: 80, width: 320 }}>
        <Notice variant="floating" placement="canvas" role="status">바뀐 내용으로 다시 배치하는 중…</Notice>
        <FloatingZoomBar onZoomOut={() => {}} onZoomIn={() => {}} onFit={() => {}} />
      </Box>
    </Stack>
  ),
}
