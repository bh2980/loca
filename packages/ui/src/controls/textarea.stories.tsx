import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../primitives/stack"
import { Textarea } from "./textarea"

const meta = { title: "Controls/Textarea", component: Textarea, args: { placeholder: "번역 지침을 입력하세요" } } satisfies Meta<typeof Textarea>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: () => (
    <Stack gap="condensed">
      <Textarea variant="caption" defaultValue="caption 본문" />
      <Textarea variant="body" defaultValue="body 본문" />
      <Textarea mono defaultValue={'{ "speaker": "민아", "line": "{name}, 가자." }'} />
    </Stack>
  ),
}

export const Behaviour: Story = {
  render: () => (
    <Stack gap="condensed">
      <Textarea autoSize defaultValue={"줄이 늘어나면 높이도 함께 늘어납니다.\n둘째 줄\n셋째 줄"} />
      <Textarea resize="none" defaultValue="크기를 손으로 바꿀 수 없습니다." />
    </Stack>
  ),
}

export const Disabled: Story = { render: () => <Textarea disabled defaultValue="수정할 수 없는 값" /> }
export const Invalid: Story = { render: () => <Textarea aria-invalid defaultValue="잘못된 값" /> }
export const LongText: Story = { render: () => <Textarea defaultValue={"아주 긴 문장이 입력되어 한 줄을 넘어가면 자동으로 줄바꿈이 됩니다. ".repeat(8)} /> }
