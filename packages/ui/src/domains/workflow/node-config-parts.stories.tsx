import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bot } from "lucide-react"
import { useState } from "react"
import { Box } from "../../primitives/box"
import { Stack } from "../../primitives/stack"
import { Button } from "../../controls/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../controls/dialog"
import { SelectItem } from "../../controls/select"
import { Text } from "../../primitives/text"
import { FieldChildren, FieldReadRow, RequestDetails, RequestPart, SelectField, TagToggle } from "./node-config-parts"
import { NodeKindIcon } from "../graph/node-card"

const meta = { title: "Domains/Workflow/Node settings", decorators: [(Story) => <Box style={{ width: 340 }}><Story /></Box>] } satisfies Meta
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
      <TagToggle tag={{ name: "붙임", color: "var(--background-color-accent)" }} sign="+" />
      <TagToggle tag={{ name: "뗌", color: "var(--background-color-accent)" }} sign="−" struck />
      <TagToggle tag={{ name: "그대로", color: "var(--background-color-accent)" }} faint />
    </Stack>
  ),
}

export const KindIcon: Story = { render: () => <Button variant="outline" paddingX="condensed"><NodeKindIcon icon={Bot} kind="ai" /> AI 노드</Button> }

export const Request: Story = {
  render: () => (
    <RequestDetails title="상세">
      <Text as="p" variant="body">지시문의 내용입니다.</Text>
    </RequestDetails>
  ),
}

export const Large: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>크게 보기</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent height="dialog">
            <DialogHeader><DialogTitle>AI 프롬프트</DialogTitle></DialogHeader>
            <Box as="pre" overflow="auto" radius="md" background="sunken" padding="normal" variant="caption" preserveLines grow minHeight={0}>긴 텍스트</Box>
          </DialogContent>
        </Dialog>
      </>
    )
  },
}

/** The parts of a request: name and size visible, content on demand; closed and open. */
export const RequestParts: Story = {
  render: () => (
    <Box border="all" borderColor="default" radius="md" paddingX="normal">
      <RequestPart title="지시문" size="1,204자">
        <Text as="p" variant="body">지시문의 내용입니다.</Text>
      </RequestPart>
      <RequestPart title="아주 긴 이름의 요청 부분: 인물 관계와 장면 요약과 용어집" size="12,345자 · 약 4,100 토큰">
        <Text as="p" variant="body">내용</Text>
      </RequestPart>
    </Box>
  ),
}

export const SelectFieldEdges: Story = {
  render: () => (
    <Stack gap="condensed">
      <SelectField value="a" ariaLabel="값 있음">
        <SelectItem value="a">같은 모델</SelectItem>
      </SelectField>
      <SelectField value="a" ariaLabel="긴 이름">
        <SelectItem value="a">아주 긴 이름의 모델: 한 줄을 넘으면 말줄임표로 줄어듭니다 아주 긴 이름</SelectItem>
      </SelectField>
    </Stack>
  ),
}
