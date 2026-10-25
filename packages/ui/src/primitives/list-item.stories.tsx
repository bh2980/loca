import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "../controls/button"
import { ListItem } from "./list-item"
import { Box } from "./box"
import { Text } from "./text"

const meta = { title: "Primitives/ListItem", decorators: [(Story) => <Box style={{ width: 360 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const ROWS = ["옥상에서 만난다", "교실에서 기다린다", "집으로 돌아간다"]

/** Rows spaced by their own vertical padding: the list ends flush at the top and the bottom. */
export const Block: Story = {
  render: () => (
    <Box as="ul" border="all" borderColor="default" radius="md" paddingX="normal">
      {ROWS.map((row) => <ListItem key={row} paddingY="condensed"><Text>{row}</Text></ListItem>)}
    </Box>
  ),
}

/** `trim="start"` takes off only the first row's top padding. */
export const TrimStart: Story = {
  render: () => (
    <Box as="ul" border="all" borderColor="default" radius="md" paddingX="normal">
      {ROWS.map((row) => <ListItem key={row} trim="start" paddingY="condensed"><Text>{row}</Text></ListItem>)}
    </Box>
  ),
}

export const InlineLayout: Story = {
  render: () => (
    <Box as="ul" border="all" borderColor="default" radius="md" paddingX="normal">
      {ROWS.map((row) => <ListItem key={row} layout="inline" gap="condensed" paddingY="condensed" justify="between"><Text>{row}</Text><Text variant="caption" tone="muted">12줄</Text></ListItem>)}
    </Box>
  ),
}

export const GridLayout: Story = {
  render: () => (
    <Box as="ul" border="all" borderColor="default" radius="md" paddingX="normal">
      {ROWS.map((row) => <ListItem key={row} layout="grid" columns={2} gap="condensed" paddingY="condensed"><Text>{row}</Text><Text variant="caption" tone="muted">대기</Text></ListItem>)}
    </Box>
  ),
}

/** `group` makes the row a hover group: a revealed button shows while the row is hovered or focused. */
export const HoverGroup: Story = {
  render: () => (
    <Box as="ul" border="all" borderColor="default" radius="md" paddingX="normal">
      {ROWS.map((row) => <ListItem key={row} layout="inline" group gap="condensed" paddingY="condensed" justify="between"><Text>{row}</Text><Button variant="ghost" reveal>삭제</Button></ListItem>)}
    </Box>
  ),
}

export const LongText: Story = {
  render: () => (
    <Box as="ul" border="all" borderColor="default" radius="md" paddingX="normal">
      <ListItem paddingY="condensed"><Text truncate display="block">이 항목의 제목은 아주 길어서 한 줄을 넘으면 말줄임표로 줄어듭니다. 이 항목의 제목은 아주 깁니다.</Text></ListItem>
    </Box>
  ),
}
