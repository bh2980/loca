import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../layout/box"
import { Stack } from "../layout/stack"
import { DetailCandidateGroup, DetailDialogueTitle, DetailIconLink, DetailIssue, DetailLineKey } from "./detail-parts"
import { Network } from "lucide-react"

const meta = { title: "Editor/Line detail parts" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Parts: Story = {
  render: () => (
    <Stack gap="condensed">
      <DetailDialogueTitle speaker="하윤" listener="민재" />
      <DetailLineKey>ch01/roof/0012</DetailLineKey>
      <DetailIconLink>
        <a href="#graph"><Network /> 12에서 열기</a>
      </DetailIconLink>
      <Box as="ul" variant="body" tone="warning"><DetailIssue>조사가 맞지 않습니다.</DetailIssue></Box>
      <DetailCandidateGroup title="AI 후보 1">…여기 있었구나.</DetailCandidateGroup>
    </Stack>
  ),
}
