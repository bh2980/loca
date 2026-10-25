import type { Meta, StoryObj } from "@storybook/react-vite"
import { Copy, Trash2 } from "lucide-react"
import { Inline } from "../layout/stack"
import { Text } from "../primitives/text"
import { RowRevealButton } from "./row-reveal-button"

const meta = { title: "Workflow/RowRevealButton" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Hover the row to reveal the buttons; the second turns red under the pointer. */
export const InRow: Story = {
  render: () => (
    <Inline gap="condensed" paddingX="normal" paddingY="condensed" border="all" radius="md" className="group/row">
      <Text grow variant="body">워크플로 이름</Text>
      <RowRevealButton aria-label="복제"><Copy /></RowRevealButton>
      <RowRevealButton hover="destructive" aria-label="삭제"><Trash2 /></RowRevealButton>
    </Inline>
  ),
}
