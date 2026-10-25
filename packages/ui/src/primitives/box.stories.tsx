import type { Meta, StoryObj } from "@storybook/react-vite"
import type * as React from "react"
import { Box } from "./box"
import { Stack } from "./stack"
import { STYLE } from "./style"
import { Text } from "./text"

const meta = {
  title: "Primitives/Box",
  component: Box,
  args: { padding: "normal", background: "sunken", radius: "md", border: "all" },
  render: (args) => (
    <Box {...args}>
      <Text variant="caption">상자 안의 내용</Text>
    </Box>
  ),
} satisfies Meta<typeof Box>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

type Option = keyof typeof STYLE

/** One option, every value side by side, each labelled with the option name and value. */
function Values({ option, render }: { option: Option; render: (value: string) => React.ReactNode }) {
  return (
    <Stack direction="row" gap="spacious" wrap align="start">
      {Object.keys(STYLE[option]).map((value) => (
        <Stack key={value} gap="tight">
          <Text variant="caption" tone="muted">{option} {value}</Text>
          {render(value)}
        </Stack>
      ))}
    </Stack>
  )
}

const Sample = ({ children }: { children?: React.ReactNode }) => <Text variant="caption">{children ?? "내용"}</Text>

export const Padding: Story = {
  render: () => <Values option="padding" render={(value) => <Box padding={value as never} background="sunken"><Sample /></Box>} />,
}

export const Backgrounds: Story = {
  render: () => <Values option="background" render={(value) => <Box padding="normal" radius="md" border="all" background={value as never}><Sample /></Box>} />,
}

export const Borders: Story = {
  render: () => <Values option="border" render={(value) => <Box padding="normal" border={value as never}><Sample /></Box>} />,
}

export const Radius: Story = {
  render: () => <Values option="radius" render={(value) => <Box padding="normal" border="all" background="sunken" radius={value as never}><Sample /></Box>} />,
}

/** `spaceY` spaces the children of a block by margins; the hairlines between them come from `divide`. */
export const SpaceAndDivide: Story = {
  render: () => (
    <Stack gap="spacious">
      <Box spaceY="condensed" radius="md" border="all" padding="normal"><Sample>하나</Sample><Sample>둘</Sample><Sample>셋</Sample></Box>
      <Box as="ul" divide="y" radius="md" border="all"><Box as="li" padding="condensed"><Sample>하나</Sample></Box><Box as="li" padding="condensed"><Sample>둘</Sample></Box></Box>
    </Stack>
  ),
}

/** A limited height that scrolls. */
export const Scrolling: Story = {
  render: () => (
    <Box maxHeight="scroll-sm" overflow="y" radius="md" border="all" padding="condensed">
      {Array.from({ length: 12 }, (_, i) => <Text key={i} as="p" variant="caption">대사 {i + 1}번</Text>)}
    </Box>
  ),
}
