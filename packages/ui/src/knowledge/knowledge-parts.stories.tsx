import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../layout/box"
import { Inline, Stack } from "../layout/stack"
import { Text } from "../primitives/text"
import { Input } from "../primitives/input"
import { EventFlowCard } from "./event-card"
import { KnowledgeCodeInput, KnowledgeLoadingBlock, KnowledgeNameBadge, KnowledgeReviewBadge, KnowledgeSummaryText, KnowledgeTextarea } from "./field-parts"
import { KnowledgeArrow, KnowledgeFold, KnowledgeInlineFlex, KnowledgeListItem, KnowledgeRowButton, KnowledgeScrollList, KnowledgeSubheadRow } from "./pane-parts"

const meta = { title: "Knowledge/Parts", decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function FoldDemo() {
  const [open, setOpen] = useState(false)
  return (
    <KnowledgeFold label="대사 보기" open={open} onOpenChange={setOpen}>
      <KnowledgeScrollList limit={60}>
        <KnowledgeListItem>
          <KnowledgeRowButton>12-001 · …여기 있었구나.</KnowledgeRowButton>
        </KnowledgeListItem>
        <KnowledgeListItem density="loose">
          <Text weight="medium">→ 연인</Text>
          <Text tone="muted"> · 고백</Text>
        </KnowledgeListItem>
      </KnowledgeScrollList>
    </KnowledgeFold>
  )
}

export const PaneParts: Story = {
  render: () => (
    <Stack gap="comfortable">
      <FoldDemo />
      <KnowledgeSubheadRow spread>
        <Text variant="caption" weight="semibold">시작 대사 선택</Text>
        <Text variant="caption" tone="muted">취소</Text>
      </KnowledgeSubheadRow>
      <Inline gap="condensed">
        <KnowledgeInlineFlex gap="tight">확정</KnowledgeInlineFlex>
        <KnowledgeArrow>→</KnowledgeArrow>
        <KnowledgeInlineFlex>후보</KnowledgeInlineFlex>
      </Inline>
    </Stack>
  ),
}

export const FieldsAndBadges: Story = {
  render: () => (
    <Stack gap="condensed">
      <KnowledgeCodeInput defaultValue="12-001" />
      <KnowledgeTextarea mono rows={3} defaultValue="# 노트" />
      <Input defaultValue="보통 입력" />
      <Inline gap="condensed"><Text weight="medium">하윤<KnowledgeNameBadge>플레이어</KnowledgeNameBadge></Text><KnowledgeReviewBadge title="이유">확인 권장</KnowledgeReviewBadge></Inline>
      <KnowledgeSummaryText>한 줄만 보이고 나머지는 말줄임표로 줄어드는 요약 문장입니다. 한 줄만 보이고 나머지는 말줄임표로 줄어드는 요약 문장입니다.</KnowledgeSummaryText>
      <KnowledgeLoadingBlock kind="timeline" />
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
