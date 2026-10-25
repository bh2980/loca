import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Input, NumberInput } from "./input"

const meta = { title: "Controls/Input", component: Input, args: { placeholder: "이름을 입력하세요" } } satisfies Meta<typeof Input>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["xs", "sm", "default"] as const).map((size) => <Input key={size} size={size} placeholder={`size ${size}`} />)}
    </Stack>
  ),
}

export const Variants: Story = {
  render: () => (
    <Stack gap="condensed">
      <Input variant="caption" defaultValue="caption 본문" />
      <Input variant="body" defaultValue="body 본문" />
      <Input mono defaultValue="src/scenes/ch01.json" />
      <Input align="right" defaultValue="1200" />
      <Input onSunken defaultValue="sunken 위의 입력" />
    </Stack>
  ),
}

export const Widths: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["field-3xs", "field-xs", "field", "field-lg", "field-2xl", "menu-xl"] as const).map((width) => <Input key={width} width={width} placeholder={width} />)}
    </Stack>
  ),
}

export const Disabled: Story = { render: () => <Input disabled defaultValue="수정할 수 없는 값" /> }
export const Invalid: Story = { render: () => <Input aria-invalid defaultValue="잘못된 값" /> }
export const LongText: Story = { render: () => <Input width="field-xl" defaultValue="아주 긴 문장이 입력되어 필드 너비를 넘어가는 경우에도 한 줄로 유지됩니다" /> }

/** Clearing or typing past a bound is allowed while typing; leaving the field settles it. */
export const Number: Story = {
  render: () => {
    const [value, setValue] = useState<number | undefined>(4)
    return (
      <Stack gap="condensed" width="field-lg">
        <NumberInput value={value} onValueChange={setValue} min={1} max={10} aria-label="동시 실행 수" />
        <NumberInput value={value} onValueChange={setValue} min={1} max={10} optional placeholder="자동" aria-label="선택 값" />
        <Text variant="caption" tone="muted">값: {value ?? "없음"}</Text>
      </Stack>
    )
  },
}
