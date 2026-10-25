import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bleed, Overlay, VirtualItem } from "./overlay"
import { Box } from "./box"
import { Inline, Stack } from "./stack"
import { Text } from "./text"

const meta = { title: "Primitives/Overlay and Bleed", decorators: [(Story) => <Box style={{ width: 360 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Fills the nearest positioned ancestor: a status or an empty state laid over a canvas. */
export const OverlayOnCanvas: Story = {
  render: () => (
    <Box position="relative" border="all" borderColor="default" radius="md" style={{ height: 120 }}>
      <Overlay asChild><Inline justify="center" background="sunken"><Text tone="muted">그래프를 불러오는 중…</Text></Inline></Overlay>
    </Box>
  ),
}

/** Rows of a virtualized list: each sits at the top of the list's box and is moved down by its transform. */
export const VirtualRows: Story = {
  render: () => (
    <Box position="relative" border="all" borderColor="default" radius="md" style={{ height: 96 }}>
      {["하윤: …여기 있었구나.", "도현: 왜 여기까지 왔어?", "지문: 바람이 분다."].map((row, index) => (
        <VirtualItem key={row} style={{ transform: `translateY(${index * 32}px)`, height: 32 }}><Box padding="condensed"><Text truncate>{row}</Text></Box></VirtualItem>
      ))}
    </Box>
  ),
}

/** A block that reaches past its parent's side padding by a named amount. */
export const Bleeds: Story = {
  render: () => (
    <Box padding="comfortable" border="all" borderColor="default" radius="md">
      <Stack gap="condensed">
        {(["tight", "condensed"] as const).map((by) => (
          <Bleed key={by} by={by} background="sunken" padding="condensed"><Text variant="caption">{by}</Text></Bleed>
        ))}
      </Stack>
    </Box>
  ),
}
