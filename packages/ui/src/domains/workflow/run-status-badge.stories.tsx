import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../../primitives/stack"
import { RunStatusBadge } from "./run-status-badge"

const meta = { title: "Domains/Workflow/Run status badge", component: RunStatusBadge, args: { status: "running" } } satisfies Meta<typeof RunStatusBadge>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Shape and color per state: running pulses, failed is a diamond. */
export const States: Story = {
  render: () => (
    <Stack gap="tight">
      {(["running", "paused", "completed", "failed", "cancelled"] as const).map((status) => <RunStatusBadge key={status} status={status} />)}
    </Stack>
  ),
}
