import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "./box"
import { Inline, Stack } from "./stack"
import { SPACING_PX } from "./style"
import { Text } from "./text"

const meta = {
  title: "Primitives/Stack",
  component: Stack,
  args: { gap: "condensed" },
  argTypes: { gap: { control: "select", options: Object.keys(SPACING_PX) }, align: { control: "select", options: [undefined, "start", "center", "end", "baseline", "stretch"] } },
} satisfies Meta<typeof Stack>
export default meta
type Story = StoryObj<typeof meta>

const Cell = ({ children }: { children: string }) => <Box padding="condensed" radius="md" border="all" background="sunken"><Text variant="caption">{children}</Text></Box>

/** A column; with no `gap` the children touch. */
export const Column: Story = { render: (args) => <Stack {...args}><Cell>원문</Cell><Cell>번역</Cell><Cell>검토</Cell></Stack> }

/** A row (`direction="row"`), or `Inline`, which also centers on the cross axis. */
export const Row: Story = {
  render: (args) => (
    <Stack gap="comfortable">
      <Stack {...args} direction="row" align="start"><Cell>원문</Cell><Cell>번역</Cell></Stack>
      <Inline {...args}><Cell>원문</Cell><Cell>번역</Cell></Inline>
    </Stack>
  ),
}

export const Justify: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["start", "center", "end", "between"] as const).map((justify) => (
        <Inline key={justify} justify={justify} gap="condensed" radius="md" border="all" padding="condensed">
          <Text variant="caption" tone="muted">{justify}</Text><Cell>하나</Cell><Cell>둘</Cell>
        </Inline>
      ))}
    </Stack>
  ),
}

export const Wrapping: Story = {
  render: () => (
    <Inline wrap gap="tight" gapY="hair" style={{ maxWidth: 240 }}>
      {["인물", "관계", "말투", "사건", "문서", "태그", "용어"].map((tag) => <Cell key={tag}>{tag}</Cell>)}
    </Inline>
  ),
}
