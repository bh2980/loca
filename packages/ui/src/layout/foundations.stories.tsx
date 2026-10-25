import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "./box"
import { Grid } from "./grid"
import { Inline, Stack } from "./stack"
import { SPACING_PX, STYLE } from "./style"
import { Text } from "../primitives/text"

const meta = { title: "Foundations/Tokens" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const TWEAK = { none: "0", hair: "0.5", tight: "1", snug: "1.5", condensed: "2", cozy: "2.5", normal: "3", comfortable: "4", roomy: "5", spacious: "6", wide: "8", section: "12" } as const

/** The spacing names every padding, margin and gap takes, each with its pixels and Tailwind step. */
export const Spacing: Story = {
  render: () => (
    <Stack gap="condensed">
      {(Object.keys(SPACING_PX) as (keyof typeof SPACING_PX)[]).map((name) => (
        <Inline key={name} gap="normal">
          <Text variant="label" minWidth={0} style={{ width: "7rem" }}>{name}</Text>
          <Text variant="caption" tone="muted" tabular style={{ width: "4rem" }}>{SPACING_PX[name]}px</Text>
          <Text variant="caption" tone="muted" mono style={{ width: "4rem" }}>{TWEAK[name]}</Text>
          <Box background="muted" radius="sm" style={{ width: SPACING_PX[name], height: "1rem", minWidth: 1, outline: "1px solid var(--primary)" }} />
        </Inline>
      ))}
    </Stack>
  ),
}

const VARIANTS = ["micro", "caption", "body", "label", "reading", "title", "heading"] as const
const SCALE = { micro: "text-2xs · 12px", caption: "text-xs · 12.5px", body: "text-sm · 13.5px", label: "text-sm font-medium", reading: "text-base · 15px", title: "text-lg · 17px", heading: "text-xl · 19px" } as const

/** The type scale. A Text adds only what is named: with no variant it keeps the size around it. */
export const TypeScale: Story = {
  render: () => (
    <Stack gap="condensed">
      {VARIANTS.map((variant) => (
        <Inline key={variant} gap="normal" align="baseline">
          <Text variant="caption" tone="muted" mono style={{ width: "9rem" }}>{variant} · {SCALE[variant]}</Text>
          <Text variant={variant}>대사를 번역하고 검토합니다</Text>
        </Inline>
      ))}
    </Stack>
  ),
}

/** Color by meaning; the semantic tokens of both themes. */
export const Tones: Story = {
  render: () => (
    <Grid columns={2} gap="condensed">
      {(Object.keys(STYLE.tone) as (keyof typeof STYLE.tone)[]).map((tone) => (
        <Text key={tone} as="div" variant="body" tone={tone}>
          {tone} · 번역이 끝났습니다 <Text tabular>1,234</Text>
        </Text>
      ))}
    </Grid>
  ),
}
