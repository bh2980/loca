import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../primitives/box"
import { Stack } from "../primitives/stack"
import { TagInput } from "./tag-input"

const meta = { title: "Controls/TagInput", decorators: [(Story) => <Box style={{ width: 420 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Demo({ initial = [], suggestions, placeholder = "이름을 입력하세요" }: { initial?: string[]; suggestions?: string[]; placeholder?: string }) {
  const [value, setValue] = useState(initial)
  return <TagInput value={value} onChange={setValue} suggestions={suggestions} placeholder={placeholder} />
}

/** Empty, with tags, and with many tags wrapping onto several lines. */
export const States: Story = {
  render: () => (
    <Stack gap="normal">
      <Demo />
      <Demo initial={["하윤", "도현"]} />
      <Demo initial={["하윤", "도현", "서연", "민재", "지우", "예린", "현우", "아주 긴 이름의 호칭 후보 하나"]} />
    </Stack>
  ),
}

/** Click into the field to see the suggestions (values already in the field are left out). */
export const WithSuggestions: Story = {
  render: () => <Demo initial={["하윤"]} suggestions={["하윤", "하윤아", "하윤이 오빠, 옥상에서 늘 혼자 앉아 있던 아주 긴 이름의 후보", "도현"]} />,
}
