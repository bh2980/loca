import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { Inline, Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { Input } from "../../controls/input"
import { Chip } from "../../patterns/chip"
import { Field } from "../../patterns/field"
import { Swatch, SwatchPicker } from "../../patterns/swatch"
import { SaveStatusLine } from "./save-status-line"
import { Skeleton } from "../../patterns/skeleton"

const meta = { title: "Domains/App/Settings parts", decorators: [(Story) => <Box style={{ width: 420 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Fields: Story = {
  render: () => (
    <Field.Group>
      <Input mono defaultValue="/usr/local/bin/codex" />
      <Inline gap="condensed"><Input width="field" type="number" defaultValue={30} /><Input width="field-xs" align="right" type="number" defaultValue={8} /></Inline>
    </Field.Group>
  ),
}

export const Swatches: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline wrap gap="tight">
        <Swatch size="icon" selected color="var(--hue-3)" />
        <Swatch size="icon" color="var(--hue-5)" />
        <SwatchPicker title="다른 색" label="다른 색" color="var(--hue-3)" value="" onValueChange={() => {}} />
      </Inline>
      <Box asChild radius="base"><Chip variant="tint" color="var(--hue-3)">#중요</Chip></Box>
    </Stack>
  ),
}

export const Status: Story = {
  render: () => (
    <Stack gap="condensed">
      <SaveStatusLine status="saving" />
      <SaveStatusLine status="saved" />
      <SaveStatusLine status="failed" onRetry={() => {}} />
      <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface"><Box padding="normal"><Text variant="caption" tone="muted">표 틀</Text></Box></Box>
      <Box spaceY="comfortable">
        <Skeleton height="control" width="1/3" />
        <Skeleton height="placeholder-sm" width="full" />
      </Box>
    </Stack>
  ),
}

/** The save line in every state. */
export const SaveStates: Story = {
  render: () => (
    <Stack gap="condensed">
      <SaveStatusLine status="saving" />
      <SaveStatusLine status="saved" />
      <SaveStatusLine status="failed" onRetry={() => {}} />
      <SaveStatusLine status="idle" />
    </Stack>
  ),
}
