import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { AiMark, StatusIcon, TagChip, type StatusLike } from "./status"

const meta = { title: "Patterns/Status" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const STATUSES: StatusLike[] = [
  { id: "untranslated", name: "미번역", color: PALETTE[0].hex, kind: "initial" },
  { id: "translated", name: "번역됨", color: PALETTE[8].hex, kind: "normal" },
  { id: "needs-review", name: "검토 필요", color: PALETTE[2].hex, kind: "normal", inReview: true },
  { id: "confirmed", name: "완료", color: PALETTE[5].hex, kind: "final" },
]

/** Shape and colour: empty ring = not started, half = in progress, filled with ! = waits for a person, filled with ✓ = done. */
export const StatusIcons: Story = {
  render: () => (
    <Stack gap="condensed">
      {STATUSES.map((status) => <Inline key={status.id} gap="condensed"><StatusIcon status={status} /><Text variant="body">{status.name}</Text></Inline>)}
      <Inline gap="condensed"><StatusIcon status={null} /><Text variant="body">상태 없음 (점선)</Text></Inline>
    </Stack>
  ),
}

/** `small` is one step smaller, for a table cell; `label` when it stands alone. */
export const Sizes: Story = {
  render: () => (
    <Inline gap="comfortable">
      <StatusIcon status={STATUSES[1]} />
      <StatusIcon status={STATUSES[1]} small />
      <StatusIcon status={STATUSES[3]} label="완료" />
    </Inline>
  ),
}

/** Every palette colour on the in-progress shape. */
export const Colors: Story = {
  render: () => (
    <Inline gap="condensed">
      {PALETTE.map((color) => <StatusIcon key={color.hex} status={{ color: color.hex, kind: "normal" }} label={color.name} />)}
    </Inline>
  ),
}

export const Tags: Story = {
  render: () => (
    <Inline gap="condensed">
      {PALETTE.slice(0, 6).map((color) => <TagChip key={color.hex} tag={{ name: color.name, color: color.hex }} />)}
      <TagChip tag={{ name: "아주 긴 이름의 태그", color: PALETTE[9].hex }} />
    </Inline>
  ),
}

/** ✦ shows only when AI set it and no person has looked since; nothing otherwise. */
export const Marks: Story = {
  render: () => (
    <Inline gap="comfortable">
      <Inline gap="tight"><AiMark by="ai" /><Text variant="caption">ai</Text></Inline>
      <Inline gap="tight"><AiMark by="human" /><Text variant="caption">human (nothing)</Text></Inline>
      <Inline gap="tight"><AiMark by={null} /><Text variant="caption">null (nothing)</Text></Inline>
    </Inline>
  ),
}
