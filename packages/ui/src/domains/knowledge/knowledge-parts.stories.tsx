import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { Inline, Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { Input } from "../../controls/input"
import { Chip } from "../../patterns/chip"
import { Textarea } from "../../controls/textarea"
import { EventFlowCard } from "./event-card"
import { Skeleton } from "../../patterns/skeleton"

const meta = { title: "Domains/Knowledge/Parts", decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const FieldsAndBadges: Story = {
  render: () => (
    <Stack gap="condensed">
      <Input mono variant="body" defaultValue="12-001" />
      <Box asChild leading="relaxed"><Textarea variant="body" mono rows={3} defaultValue="# 노트" /></Box>
      <Input defaultValue="보통 입력" />
      <Inline gap="condensed"><Text weight="medium">하윤<Box asChild marginLeft="condensed"><Chip variant="outline">플레이어</Chip></Box></Text><Chip variant="outline" tone="warning" title="이유">확인 권장</Chip></Inline>
      <Text lines={1} tone="muted">한 줄만 보이고 나머지는 말줄임표로 줄어드는 요약 문장입니다. 한 줄만 보이고 나머지는 말줄임표로 줄어드는 요약 문장입니다.</Text>
      <Skeleton height="placeholder-md" />
    </Stack>
  ),
}

export const EventCard: Story = {
  render: () => (
    <Inline gap="condensed" align="start">
      <EventFlowCard framed><Text variant="label">선택된 사건</Text></EventFlowCard>
      <EventFlowCard candidate><Text variant="label">후보 사건</Text></EventFlowCard>
    </Inline>
  ),
}

export const EventCardEdges: Story = {
  render: () => (
    <Stack gap="condensed">
      <EventFlowCard><Text variant="label">평범한 사건</Text></EventFlowCard>
      <EventFlowCard framed candidate><Text variant="label">후보이면서 선택된 사건</Text></EventFlowCard>
      <EventFlowCard><Text variant="label" truncate>아주 긴 이름의 사건: 비 오는 날 옥상에서 두 사람이 처음 마주치고 이야기를 나눈다</Text></EventFlowCard>
    </Stack>
  ),
}
