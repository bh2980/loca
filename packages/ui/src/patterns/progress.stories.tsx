import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Progress } from "./progress"

const meta = { title: "Patterns/Progress", component: Progress, decorators: [(Story) => <Box style={{ width: 320 }}><Story /></Box>] } satisfies Meta<typeof Progress>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { value: 40 } }

export const Values: Story = {
  render: () => <Stack gap="condensed"><Progress value={0} /><Progress value={35} /><Progress value={100} /></Stack>,
}

export const Tones: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["accent", "success", "warning", "danger"] as const).map((tone) => <Progress key={tone} value={60} tone={tone} />)}
    </Stack>
  ),
}

export const Sizes: Story = { render: () => <Stack gap="condensed"><Progress value={60} size="sm" /><Progress value={60} size="md" /></Stack> }

/** Moves instead of sitting at 0 while one long step is under way. */
export const Indeterminate: Story = {
  render: () => <Stack gap="condensed"><Progress indeterminate /><Progress indeterminate tone="warning" size="sm" /></Stack>,
}

/** In a row: `grow` takes the room left; `reserve` keeps at least 4rem. */
export const InARow: Story = {
  render: () => (
    <Inline gap="condensed">
      <Text variant="caption" tone="muted" nowrap>번역 중</Text>
      <Progress value={50} grow />
      <Text variant="caption" tone="muted" tabular>50%</Text>
    </Inline>
  ),
}

export const Reserve: Story = {
  decorators: [(Story) => <Box style={{ width: 160 }}><Story /></Box>],
  render: () => (
    <Inline gap="condensed">
      <Text variant="caption" tone="muted" nowrap>아주 긴 라벨의 작업</Text>
      <Progress value={50} grow="reserve" />
    </Inline>
  ),
}
