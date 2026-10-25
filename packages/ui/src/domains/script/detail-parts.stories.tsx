import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { DetailIssue } from "./detail-parts"

const meta = { title: "Domains/Script/Line detail" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Parts: Story = {
  render: () => (
    <Box as="ul" variant="body" tone="warning"><DetailIssue>조사가 맞지 않습니다.</DetailIssue></Box>
  ),
}

export const Several: Story = {
  render: () => (
    <Box as="ul" variant="body" tone="warning">
      <DetailIssue>조사가 맞지 않습니다.</DetailIssue>
      <DetailIssue>용어 '옥상'이 번역에 없습니다. 용어집에서는 '루프탑'으로 정해 두었는데 이 줄에서는 다른 말을 썼습니다.</DetailIssue>
    </Box>
  ),
}
