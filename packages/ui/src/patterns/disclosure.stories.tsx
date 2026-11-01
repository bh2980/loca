import type { Meta, StoryObj } from "@storybook/react-vite"
import { Input } from "../controls/input"
import { Box } from "../primitives/box"
import { Disclosure } from "./disclosure"
import { Field } from "./field"

const meta = { title: "Patterns/Disclosure", component: Disclosure, decorators: [(Story) => <Box style={{ width: 360 }}><Story /></Box>] } satisfies Meta<typeof Disclosure>
export default meta
type Story = StoryObj<typeof meta>

/** Starts open; folding it is remembered under `persistKey`. */
export const Default: Story = {
  args: { persistKey: "story.disclosure" },
  render: () => (
    <Disclosure persistKey="story.disclosure">
      <Field label="최대 토큰"><Input defaultValue="4096" /></Field>
      <Field label="재시도"><Input defaultValue="2" /></Field>
    </Disclosure>
  ),
}

export const CustomLabel: Story = { args: { persistKey: "story.disclosure.custom", label: "프롬프트 보기", children: "시스템 프롬프트 전문이 여기에 들어갑니다." } }

export const LongLabel: Story = { args: { persistKey: "story.disclosure.long", label: "아주 긴 라벨은 한 줄에 들어가지 않으면 말줄임표로 잘리고 화살표는 그대로 남습니다", children: "내용" } }
