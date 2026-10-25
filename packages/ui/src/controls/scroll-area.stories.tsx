import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { ScrollArea } from "./scroll-area"

const meta = { title: "Controls/ScrollArea", component: ScrollArea } satisfies Meta<typeof ScrollArea>
export default meta
type Story = StoryObj<typeof meta>

const Rows = ({ count }: { count: number }) => <Stack gap="condensed" padding="condensed">{Array.from({ length: count }, (_, index) => <Text key={index} variant="caption">대사 {index + 1}</Text>)}</Stack>

export const Default: Story = { render: () => <Box height="placeholder-md" width="menu-lg" border="all" radius="md"><ScrollArea style={{ height: "100%" }}><Rows count={30} /></ScrollArea></Box> }
export const NoOverflow: Story = { render: () => <Box height="placeholder-md" width="menu-lg" border="all" radius="md"><ScrollArea style={{ height: "100%" }}><Rows count={3} /></ScrollArea></Box> }
/** A long row stays inside the area (vertical scrolling only). */
export const LongText: Story = {
  render: () => <Box height="placeholder-md" width="menu-lg" border="all" radius="md"><ScrollArea style={{ height: "100%" }}><Stack padding="condensed"><Text variant="caption">{"아주 긴 한 줄의 대사가 영역의 너비를 넘어가도 오른쪽으로 밀려나지 않고 감싸집니다. ".repeat(4)}</Text></Stack></ScrollArea></Box>,
}
