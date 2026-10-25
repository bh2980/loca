import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Separator } from "./separator"

const meta = { title: "Controls/Separator", component: Separator } satisfies Meta<typeof Separator>
export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = { render: () => <Stack gap="condensed"><Text variant="caption">위</Text><Separator /><Text variant="caption">아래</Text></Stack> }
export const Vertical: Story = { render: () => <Inline gap="condensed" height="control"><Text variant="caption">왼쪽</Text><Separator orientation="vertical" /><Text variant="caption">오른쪽</Text></Inline> }
