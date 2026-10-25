import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../layout/box"
import { JobProgressBar } from "./job-progress-bar"

const meta = { title: "Workflow/Job progress", decorators: [(Story) => <Box style={{ width: 280 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Counted: Story = { render: () => <JobProgressBar done={42} total={120} running /> }

/** One long step (a single model call): the bar moves instead of sitting at 0. */
export const SingleStep: Story = { render: () => <JobProgressBar done={0} total={1} running /> }
