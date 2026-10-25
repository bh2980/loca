import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../layout/box"
import { Inline, Stack } from "../layout/stack"
import { Text } from "../primitives/text"
import { MonoInput, NumberFieldInput, SettingsFieldGroup } from "./field-parts"
import { SaveStatusLine, SettingsPageSkeleton } from "./page-parts"
import { PickerSwatch, PickerSwatchInput, SwatchButton, SwatchDot, TagPreviewChip, NO_COLOR_PICKER_DEFAULT } from "./swatch-parts"
import { TablePanel } from "./table-parts"

const meta = { title: "Settings/Parts", decorators: [(Story) => <Box style={{ width: 420 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Fields: Story = {
  render: () => (
    <SettingsFieldGroup>
      <MonoInput defaultValue="/usr/local/bin/codex" />
      <Inline gap="condensed"><NumberFieldInput type="number" defaultValue={30} /><NumberFieldInput width="count" type="number" defaultValue={8} /></Inline>
    </SettingsFieldGroup>
  ),
}

export const Swatches: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline wrap gap="tight">
        <SwatchButton variant="ghost" size="icon" selected><SwatchDot style={{ backgroundColor: "var(--hue-3)" }} /></SwatchButton>
        <SwatchButton variant="ghost" size="icon"><SwatchDot style={{ backgroundColor: "var(--hue-5)" }} /></SwatchButton>
        <PickerSwatch title="다른 색"><SwatchDot style={{ backgroundColor: NO_COLOR_PICKER_DEFAULT }} /><PickerSwatchInput aria-label="다른 색" defaultValue={NO_COLOR_PICKER_DEFAULT} /></PickerSwatch>
      </Inline>
      <TagPreviewChip color="var(--hue-3)">#중요</TagPreviewChip>
    </Stack>
  ),
}

export const Status: Story = {
  render: () => (
    <Stack gap="condensed">
      <SaveStatusLine status="saving" />
      <SaveStatusLine status="saved" />
      <SaveStatusLine status="failed" onRetry={() => {}} />
      <TablePanel card><Box padding="normal"><Text variant="caption" tone="muted">표 틀</Text></Box></TablePanel>
      <SettingsPageSkeleton shape="editor" />
    </Stack>
  ),
}
