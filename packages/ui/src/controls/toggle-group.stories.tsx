import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../primitives/stack"
import { ToggleGroup, ToggleGroupItem } from "./toggle-group"

const meta = { title: "Controls/ToggleGroup" } satisfies Meta
export default meta
type Story = StoryObj

const Items = ({ disabled }: { disabled?: boolean }) => (
  <>
    <ToggleGroupItem value="source">원문</ToggleGroupItem>
    <ToggleGroupItem value="draft">초벌</ToggleGroupItem>
    <ToggleGroupItem value="final" disabled={disabled}>확정</ToggleGroupItem>
  </>
)

export const Single: Story = { render: () => <ToggleGroup type="single" variant="outline" defaultValue="draft"><Items /></ToggleGroup> }
export const Multiple: Story = { render: () => <ToggleGroup type="multiple" variant="outline" defaultValue={["source", "final"]}><Items /></ToggleGroup> }

export const Variants: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["default", "outline"] as const).map((variant) => <ToggleGroup key={variant} type="single" variant={variant} defaultValue="source"><Items /></ToggleGroup>)}
    </Stack>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["sm", "default", "lg"] as const).map((size) => <ToggleGroup key={size} type="single" variant="outline" size={size} defaultValue="source"><Items /></ToggleGroup>)}
    </Stack>
  ),
}

export const Spacing: Story = { render: () => <ToggleGroup type="multiple" variant="outline" spacing={2}><Items /></ToggleGroup> }
export const Disabled: Story = { render: () => <ToggleGroup type="single" variant="outline" disabled defaultValue="source"><Items /></ToggleGroup> }
export const OneItemDisabled: Story = { render: () => <ToggleGroup type="single" variant="outline"><Items disabled /></ToggleGroup> }
