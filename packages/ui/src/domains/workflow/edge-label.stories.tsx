import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { EdgeLabelPill, EdgeLabelRow } from "./edge-label"

const meta = { title: "Domains/Workflow/Edge label", decorators: [(Story) => <Box position="relative" style={{ width: 280, height: 80 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A line's label, laid over the graph (the page gives the position). */
export const Floating: Story = { render: () => <EdgeLabelPill floating style={{ left: 40, top: 20 }}>통과</EdgeLabelPill> }

export const InRow: Story = { render: () => <EdgeLabelRow style={{ left: 40, top: 20 }}><EdgeLabelPill>실패</EdgeLabelPill></EdgeLabelRow> }
