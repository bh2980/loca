import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bot } from "lucide-react"
import { useState } from "react"
import { Box } from "../layout/box"
import { Stack } from "../layout/stack"
import { Button } from "../primitives/button"
import { SelectItem } from "../primitives/select"
import { Text } from "../primitives/text"
import { FieldChildren, FieldReadRow, LargeDialog, NodeKindIcon, RequestDetails, RequestPart, SelectField, TagToggle } from "./node-config-parts"

const meta = { title: "Workflow/Node settings parts", decorators: [(Story) => <Box style={{ width: 340 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const FullWidthSelect: Story = {
  render: () => (
    <SelectField value="a" ariaLabel="예시">
      <SelectItem value="a">같은 모델</SelectItem>
      <SelectItem value="b">다른 모델</SelectItem>
    </SelectField>
  ),
}

export const JsonFieldRows: Story = {
  render: () => (
    <Stack gap="tight">
      <FieldReadRow role="button" tabIndex={0}>
        <Text mono weight="semibold" tone="default" variant="body">name</Text> <Text variant="caption" tone="muted">텍스트 · 필수</Text>
      </FieldReadRow>
      <FieldReadRow role="button" tabIndex={0}>
        <Text mono weight="semibold" tone="default" variant="body">items</Text> <Text variant="caption" tone="muted">목록</Text>
      </FieldReadRow>
      <FieldChildren active>
        <Text variant="caption" tone="muted">목록 안의 필드 (편집 중)</Text>
      </FieldChildren>
      <FieldChildren>
        <Text variant="caption" tone="muted">목록 안의 필드</Text>
      </FieldChildren>
    </Stack>
  ),
}

export const TagToggles: Story = {
  render: () => (
    <Stack direction="row" wrap gap="snug">
      <TagToggle tag={{ name: "붙임", color: "var(--primary)" }} sign="+" />
      <TagToggle tag={{ name: "뗌", color: "var(--primary)" }} sign="−" struck />
      <TagToggle tag={{ name: "그대로", color: "var(--primary)" }} faint />
    </Stack>
  ),
}

export const KindIcon: Story = { render: () => <Button variant="outline" paddingX="condensed"><NodeKindIcon icon={Bot} kind="ai" /> AI 노드</Button> }

export const RequestParts: Story = {
  render: () => (
    <RequestDetails title="상세">
      <RequestPart title="지시문" size="120자"><Text as="p" variant="body">지시문의 내용입니다.</Text></RequestPart>
      <RequestPart title="항목" size="3줄"><Text as="p" variant="body">항목 목록</Text></RequestPart>
    </RequestDetails>
  ),
}

export const Large: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>크게 보기</Button>
        <LargeDialog open={open} onOpenChange={setOpen} title="AI 프롬프트">
          <Box as="pre" overflow="auto" radius="md" background="muted" padding="normal" variant="caption" preserveLines grow minHeight={0}>긴 텍스트</Box>
        </LargeDialog>
      </>
    )
  },
}
