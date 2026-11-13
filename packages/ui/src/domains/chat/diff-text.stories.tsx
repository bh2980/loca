import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { DiffText } from "./diff-text"

const meta = {
  title: "Domains/Chat/Diff text",
  decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const OneLine: Story = {
  render: () => (
    <DiffText
      rows={[
        { type: "removed", parts: [{ text: "자연스럽게 " }, { text: "반말로", mark: true }, { text: " 번역하세요." }] },
        { type: "added", parts: [{ text: "자연스럽게 " }, { text: "존댓말로", mark: true }, { text: " 번역하세요." }] },
      ]}
    />
  ),
}

export const MultiLineFolded: Story = {
  render: () => (
    <DiffText
      rows={[
        { type: "folded", count: 6 },
        { type: "same", parts: [{ text: "화자의 말투를 지킵니다." }] },
        { type: "same", parts: [{ text: "고유명사는 용어집을 따릅니다." }] },
        { type: "removed", parts: [{ text: "인물은 " }, { text: "해요체", mark: true }, { text: "로 말합니다." }] },
        { type: "added", parts: [{ text: "인물은 " }, { text: "해체(반말)", mark: true }, { text: "로 말합니다." }] },
        { type: "added", parts: [{ text: "줄바꿈을 유지합니다.", mark: true }] },
        { type: "same", parts: [{ text: "서식 토큰은 바꾸지 않습니다." }] },
        { type: "same", parts: [{ text: "번역문만 출력합니다." }] },
        { type: "folded", count: 4 },
      ]}
    />
  ),
}
