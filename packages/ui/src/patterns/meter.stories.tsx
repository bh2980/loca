import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { Box } from "../primitives/box"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Meter } from "./meter"
import type { StatusLike } from "./status"

const meta = { title: "Patterns/Meter", decorators: [(Story) => <Box style={{ width: 320 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const STATUSES: StatusLike[] = [
  { id: "untranslated", name: "미번역", color: PALETTE[0].hex, kind: "initial" },
  { id: "translated", name: "번역됨", color: PALETTE[8].hex, kind: "normal" },
  { id: "needs-review", name: "검토 필요", color: PALETTE[2].hex, kind: "normal", inReview: true },
  { id: "confirmed", name: "완료", color: PALETTE[5].hex, kind: "final" },
]

/** "Not started" statuses are left out, so the bar shows how far along things are. */
export const Default: Story = { render: () => <Meter statuses={STATUSES} counts={{ untranslated: 4200, translated: 1800, "needs-review": 600, confirmed: 2400 }} /> }

export const Sizes: Story = {
  render: () => (
    <Stack gap="condensed">
      <Meter statuses={STATUSES} counts={{ translated: 3, confirmed: 5 }} size="sm" />
      <Meter statuses={STATUSES} counts={{ translated: 3, confirmed: 5 }} size="md" />
    </Stack>
  ),
}

/** `full` fills its row; `compact` is a small fixed length that never shrinks. */
export const Widths: Story = {
  render: () => (
    <Stack gap="condensed">
      <Meter statuses={STATUSES} counts={{ translated: 3, confirmed: 5 }} width="full" />
      <Inline gap="condensed"><Text variant="caption" tone="muted">3화</Text><Meter statuses={STATUSES} counts={{ translated: 3, confirmed: 5 }} width="compact" /></Inline>
    </Stack>
  ),
}

/** No counts, or only unstarted lines: an empty track. */
export const Empty: Story = {
  render: () => (
    <Stack gap="condensed">
      <Meter statuses={STATUSES} counts={{}} />
      <Meter statuses={STATUSES} counts={{ untranslated: 120 }} />
    </Stack>
  ),
}

export const AllDone: Story = { render: () => <Meter statuses={STATUSES} counts={{ confirmed: 120 }} /> }
