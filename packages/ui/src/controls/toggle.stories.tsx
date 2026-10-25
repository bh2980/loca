import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bold } from "lucide-react"
import { Inline, Stack } from "../primitives/stack"
import { Toggle } from "./toggle"

const meta = { title: "Controls/Toggle", component: Toggle } satisfies Meta<typeof Toggle>
export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["default", "outline"] as const).map((variant) => (
        <Inline key={variant} gap="condensed">
          <Toggle variant={variant} aria-label="굵게"><Bold /></Toggle>
          <Toggle variant={variant} defaultPressed aria-label="굵게 켜짐"><Bold /></Toggle>
          <Toggle variant={variant} disabled aria-label="굵게 비활성"><Bold /></Toggle>
          <Toggle variant={variant} aria-invalid aria-label="굵게 오류"><Bold /></Toggle>
        </Inline>
      ))}
    </Stack>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Inline gap="condensed">
      {(["sm", "default", "lg"] as const).map((size) => <Toggle key={size} variant="outline" size={size}>{size}</Toggle>)}
    </Inline>
  ),
}

export const LongText: Story = { render: () => <Toggle variant="outline">아주 긴 이름의 토글 버튼</Toggle> }
