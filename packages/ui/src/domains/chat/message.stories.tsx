import type { Meta, StoryObj } from "@storybook/react-vite"
import { Copy, Pencil, X } from "lucide-react"
import { Box } from "../../primitives/box"
import { Inline, Stack } from "../../primitives/stack"
import { Button } from "../../controls/button"
import { Icon } from "../../primitives/icon"
import { Spinner } from "../../controls/spinner"
import { Text } from "../../primitives/text"
import { AttachmentChip } from "./attachment-chip"
import { Markdown } from "../../patterns/markdown"
import { AssistantMessage, ImageChip, MessageActionBar, SentImage, SteerBubble, UserMessage } from "./message"
import { Notice } from "../../patterns/notice"

const meta = { title: "Domains/Chat/Message", decorators: [(Story) => <Box maxWidth="full" style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="gray" fill-opacity="0.3"/><text x="80" y="55" text-anchor="middle" font-size="14" fill="gray">screenshot</text></svg>')}`

const Actions = ({ edit = false }: { edit?: boolean }) => (
  <MessageActionBar>
    <Button type="button" variant="ghost" size="icon-xs" tone="muted" aria-label="메시지 복사"><Copy /></Button>
    {edit && <Button type="button" variant="ghost" size="icon-xs" tone="muted" aria-label="수정해서 보내기"><Pencil /></Button>}
  </MessageActionBar>
)

/** What the person wrote; hover the message to see its actions. */
export const User: Story = {
  render: () => (
    <UserMessage actions={<Actions edit />}>
      <span>1장 장면의 하윤 말투를 반말로 정리해 줘.</span>
      <Stack direction="row" wrap marginTop="snug" gap="tight" aria-label="첨부한 항목">
        <AttachmentChip kind="장면" label="1장 · 옥상에서" title="1장 · 옥상에서" onOpen={() => {}} openLabel="장면 1장 · 옥상에서 열기" />
        <AttachmentChip kind="인물" label="하윤" title="하윤" onOpen={() => {}} openLabel="인물 하윤 열기" />
      </Stack>
      <Stack direction="row" wrap marginTop="snug" gap="snug"><SentImage src={PICTURE} alt="붙인 이미지" /></Stack>
    </UserMessage>
  ),
}

export const Assistant: Story = {
  render: () => (
    <AssistantMessage>
      <Markdown>{"**하윤**의 말투 규칙을 정리했습니다.\n\n- 친구에게: 반말, 짧은 문장\n- 선생님에게: 존댓말\n\n| 대상 | 말투 |\n| --- | --- |\n| 민재 | 반말 |\n| 선생님 | 존댓말 |"}</Markdown>
      <Actions />
    </AssistantMessage>
  ),
}

/** A message sent while a reply was running: waiting for the reply's next step, or already taken in. */
export const Steer: Story = {
  render: () => (
    <Stack gap="roomy">
      <SteerBubble
        waiting
        label="전달 대기 중"
        actions={
          <>
            <Button variant="ghost" size="icon-xs" aria-label="입력창으로 되돌려 수정"><Pencil /></Button>
            <Button variant="ghost" size="icon-xs" aria-label="보내기 취소"><X /></Button>
          </>
        }
      >
        민재 대사도 같이 봐 줘.
      </SteerBubble>
      <SteerBubble label="진행 중에 보냄">반말로만 바꿔 줘.</SteerBubble>
    </Stack>
  ),
}

export const Status: Story = {
  render: () => (
    <Stack gap="roomy">
      <Inline as="p" gap="condensed" variant="body" tone="muted"><Spinner /> 생각하는 중…</Inline>
      <Inline as="p" gap="snug" variant="caption" tone="muted" role="status"><Icon icon={X} size="xs" /> 중지됨</Inline>
      <Notice tone="danger" as="p">모델 서버가 응답하지 않습니다. 잠시 뒤 다시 시도하세요.</Notice>
    </Stack>
  ),
}

/** The pictures pasted into the box; dimmed when the chosen model cannot read pictures. */
export const PastedImages: Story = {
  render: () => (
    <Inline wrap gap="snug">
      <ImageChip src={PICTURE} alt="캡처 1" removeLabel="캡처 1 빼기" onRemove={() => {}} />
      <ImageChip src={PICTURE} alt="캡처 2" dimmed removeLabel="캡처 2 빼기" onRemove={() => {}} />
      <Text variant="caption" tone="muted">오른쪽: 이 모델은 이미지를 읽지 못합니다</Text>
    </Inline>
  ),
}
