import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Stack } from "../primitives/stack"
import { Skeleton } from "./skeleton"

const meta = { title: "Patterns/Skeleton", component: Skeleton, decorators: [(Story) => <Box style={{ width: 320 }}><Story /></Box>] } satisfies Meta<typeof Skeleton>
export default meta
type Story = StoryObj<typeof meta>

/** The height it stands in for: a line of text, a list row, a card, the body of a pane. */
export const Shapes: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["line", "row", "card", "page"] as const).map((shape) => <Skeleton key={shape} shape={shape} />)}
    </Stack>
  ),
}

/** `count` draws several of the same. */
export const Count: Story = {
  render: () => <Stack gap="tight"><Skeleton shape="row" count={4} /></Stack>,
}

/** Its own `width` and `height` (by token name) instead of a shape. */
export const OwnSize: Story = {
  render: () => (
    <Stack gap="condensed">
      <Skeleton shape="line" width="1/2" />
      <Skeleton height="placeholder-sm" />
      <Skeleton shape="line" width="2/3" />
    </Stack>
  ),
}
