import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Grid } from "../primitives/grid"
import { Inline, Stack } from "../primitives/stack"
import { SPACING_PX, STYLE } from "../primitives/style"
import { Text } from "../primitives/text"

const meta = { title: "Foundations/Tokens" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const TWEAK = { none: "0", hair: "0.5", tight: "1", condensed: "2", normal: "3", comfortable: "4", spacious: "6", wide: "8", section: "12" } as const

/** The spacing names every padding, margin and gap takes, each with its pixels and Tailwind step. */
export const Spacing: Story = {
  render: () => (
    <Stack gap="condensed">
      {(Object.keys(SPACING_PX) as (keyof typeof SPACING_PX)[]).map((name) => (
        <Inline key={name} gap="normal">
          <Text variant="label" minWidth={0} style={{ width: "7rem" }}>{name}</Text>
          <Text variant="caption" tone="muted" tabular style={{ width: "4rem" }}>{SPACING_PX[name]}px</Text>
          <Text variant="caption" tone="muted" mono style={{ width: "4rem" }}>{TWEAK[name]}</Text>
          <Box background="sunken" radius="sm" style={{ width: SPACING_PX[name], height: "1rem", minWidth: 1, outline: "1px solid var(--border-color-accent)" }} />
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

const WIDTHS = Object.keys(STYLE.width).filter((name) => !name.includes("/") && name !== "full") as (keyof typeof STYLE.width)[]

/** The width names (tokens/system.css): each box has the width of its name. */
export const Widths: Story = {
  render: () => (
    <Stack gap="tight">
      {WIDTHS.map((name) => (
        <Inline key={name} gap="normal">
          <Text variant="caption" tone="muted" mono width="field-lg" shrink={false}>{name}</Text>
          <Box width={name} height="icon" background="sunken" radius="sm" shrink={false} />
        </Inline>
      ))}
    </Stack>
  ),
}

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
const MEANING = ["lowest surface", "work area", "side pane", "strip", "sunken · hover", "faint line", "line", "strong line", "field edge", "faint text", "secondary text", "body text"] as const

/** The two neutral scales (tokens/palette.css): twelve numbered steps each, the same meaning in both themes. Theme.css points every role at a step. */
export const NeutralScales: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["slate", "night"] as const).map((family) => (
        <Stack key={family} gap="tight">
          <Text variant="label">{family} · {family === "slate" ? "light theme" : "dark theme"}</Text>
          <Inline gap="none" align="stretch">
            {STEPS.map((step) => (
              <Stack key={step} gap="tight" grow minWidth={0}>
                <Box style={{ height: "3rem", background: `var(--${family}-${step})`, outline: "1px solid var(--border-color-default)" }} />
                <Text variant="caption" tone="muted" mono>{step}</Text>
              </Stack>
            ))}
          </Inline>
        </Stack>
      ))}
      <Text variant="caption" tone="muted">{STEPS.map((step) => `${step} ${MEANING[step - 1]}`).join(" · ")}</Text>
    </Stack>
  ),
}

const HEIGHTS = { height: STYLE.height, maxHeight: STYLE.maxHeight, minHeight: STYLE.minHeight } as const

/** The height names (tokens/system.css), grouped by the option that takes them. */
export const Heights: Story = {
  render: () => (
    <Stack gap="condensed">
      {(Object.keys(HEIGHTS) as (keyof typeof HEIGHTS)[]).map((option) => (
        <Inline key={option} gap="normal" wrap>
          <Text variant="caption" tone="muted" mono width="field-lg" shrink={false}>{option}</Text>
          <Text variant="caption" mono>{Object.keys(HEIGHTS[option]).filter((name) => !["full", "auto", "0"].includes(name)).join(" · ")}</Text>
        </Inline>
      ))}
    </Stack>
  ),
}
