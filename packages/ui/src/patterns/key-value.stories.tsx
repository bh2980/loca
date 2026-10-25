import type { Meta, StoryObj } from "@storybook/react-vite"
import { Input } from "../controls/input"
import { Box } from "../primitives/box"
import { Chip } from "./chip"
import { KeyValue, KeyValueRow } from "./key-value"

const meta = { title: "Patterns/KeyValue", component: KeyValue, decorators: [(Story) => <Box style={{ width: 360 }}><Story /></Box>] } satisfies Meta<typeof KeyValue>
export default meta
type Story = StoryObj<typeof meta>

/** `center`: the facts of an item, label and value centred on each other. */
export const Center: Story = {
  render: () => (
    <KeyValue>
      <KeyValueRow label="화자">하윤</KeyValueRow>
      <KeyValueRow label="장면">3화 · 옥상</KeyValueRow>
      <KeyValueRow label="상태"><Chip variant="quiet">검토 필요</Chip></KeyValueRow>
    </KeyValue>
  ),
}

/** `start`: label and value aligned at the top, for values or controls that may wrap. */
export const Start: Story = {
  render: () => (
    <KeyValue align="start">
      <KeyValueRow label="말투">친구에게는 반말, 선생님에게는 존댓말을 쓰고 감탄사를 자주 섞는다.</KeyValueRow>
      <KeyValueRow label="필터"><Input defaultValue="상태 = 검토 필요" /></KeyValueRow>
    </KeyValue>
  ),
}

export const Framed: Story = {
  render: () => (
    <KeyValue framed>
      <KeyValueRow label="모델">gpt-6.1-sol</KeyValueRow>
      <KeyValueRow label="호출">1,240회</KeyValueRow>
    </KeyValue>
  ),
}

/** `description` under both label and value, in either alignment. */
export const Description: Story = {
  render: () => (
    <Box spaceY="comfortable">
      <KeyValue>
        <KeyValueRow label="최대 길이" description="이 길이를 넘는 번역은 경고합니다.">40자</KeyValueRow>
      </KeyValue>
      <KeyValue align="start">
        <KeyValueRow label="최대 길이" description="이 길이를 넘는 번역은 경고합니다.">40자</KeyValueRow>
      </KeyValue>
    </Box>
  ),
}

export const LongText: Story = {
  render: () => (
    <KeyValue>
      <KeyValueRow label="아주 긴 라벨이 여러 줄로 나뉘는 경우">값</KeyValueRow>
      <KeyValueRow label="경로">/Users/하윤/Documents/translation-workbench/projects/summer/script-with-a-very-long-file-name.json</KeyValueRow>
    </KeyValue>
  ),
}

export const Empty: Story = {
  render: () => <KeyValue><KeyValueRow label="화자">—</KeyValueRow><KeyValueRow label="메모" /></KeyValue>,
}
