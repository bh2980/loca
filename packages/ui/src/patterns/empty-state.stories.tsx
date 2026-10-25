import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inbox, SearchX } from "lucide-react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Icon } from "../primitives/icon"
import { Stack } from "../primitives/stack"
import { EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyState, EmptyTitle } from "./empty-state"

const meta = { title: "Patterns/EmptyState", decorators: [(Story) => <Box style={{ width: 400 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A line with room around it: "아직 {noun}이 없습니다" (the particle follows the noun). */
export const Inline: Story = {
  render: () => <Stack gap="comfortable"><EmptyState noun="용어" /><EmptyState noun="인물" /><EmptyState noun="관계" /></Stack>,
}

/** `filtered`: the data exists, the filter hides it. */
export const Filtered: Story = { render: () => <EmptyState noun="용어" filtered /> }

/** A `hint` and an `action` (not shown when filtered). */
export const HintAndAction: Story = {
  render: () => <EmptyState noun="워크플로" hint="워크플로는 상태 사이에서 AI가 번역하는 단계입니다." action={<Button>워크플로 만들기</Button>} />,
}

/** `roomy` for a list that has nothing to show. */
export const Roomy: Story = { render: () => <EmptyState noun="실행 기록" variant="roomy" /> }

/** `pane`: a dashed frame that takes the room of its pane, built from the Empty parts. */
export const Pane: Story = {
  decorators: [(Story) => <Box style={{ width: 480, height: 280, display: "flex" }}><Story /></Box>],
  render: () => (
    <EmptyState size="pane">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon icon={Inbox} /></EmptyMedia>
        <EmptyTitle>선택한 줄이 없습니다</EmptyTitle>
        <EmptyDescription>표에서 줄을 고르면 여기에서 번역을 다듬을 수 있습니다.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button variant="outline">첫 줄 선택</Button></EmptyContent>
    </EmptyState>
  ),
}

export const PaneMediaVariants: Story = {
  decorators: [(Story) => <Box style={{ width: 480, height: 240, display: "flex" }}><Story /></Box>],
  render: () => (
    <EmptyState size="pane">
      <EmptyHeader>
        <EmptyMedia><Icon icon={SearchX} size="md" tone="muted" /></EmptyMedia>
        <EmptyTitle>아주 긴 제목은 가운데 정렬로 여러 줄에 나뉘어 보입니다</EmptyTitle>
        <EmptyDescription>설명도 길면 최대 폭에서 줄이 바뀌고, 균형 있게 나뉩니다. 설명도 길면 줄이 바뀝니다.</EmptyDescription>
      </EmptyHeader>
    </EmptyState>
  ),
}

/** `page` centers the frame in the whole window (an error that replaces a page). */
export const Page: Story = {
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <Box style={{ display: "flex" }}><Story /></Box>],
  render: () => (
    <EmptyState size="page">
      <EmptyHeader>
        <EmptyTitle>프로젝트를 찾을 수 없습니다</EmptyTitle>
        <EmptyDescription>주소가 바뀌었거나 삭제된 프로젝트입니다.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button>프로젝트 목록으로</Button></EmptyContent>
    </EmptyState>
  ),
}
