import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { useState } from "react"
import { Inline } from "../primitives/stack"
import { Swatch, SwatchPicker } from "./swatch"

const meta = { title: "Patterns/Swatch", component: Swatch } satisfies Meta<typeof Swatch>
export default meta
type Story = StoryObj<typeof meta>

/** A row of colors: the picked one is outlined. */
export const Row: Story = {
  render: () => {
    const [value, setValue] = useState<string | null>(PALETTE[8].hex)
    return (
      <Inline gap="hair">
        <Swatch selected={value === null} onClick={() => setValue(null)}>없음</Swatch>
        {PALETTE.map((color) => (
          <Swatch key={color.hex} size="icon" color={color.hex} selected={value === color.hex} aria-label={color.name} title={color.name} onClick={() => setValue(color.hex)} />
        ))}
      </Inline>
    )
  },
}

export const Disabled: Story = {
  render: () => (
    <Inline gap="hair">
      <Swatch disabled>없음</Swatch>
      <Swatch disabled size="icon" color={PALETTE[1].hex} aria-label="빨강" />
    </Inline>
  ),
}

/** The swatch that opens the browser's color picker; an empty `value` shows its neutral grey. */
export const Picker: Story = {
  render: () => {
    const [value, setValue] = useState("")
    return (
      <Inline gap="condensed">
        <SwatchPicker label="직접 고르기" title="직접 고르기" color={value || PALETTE[0].hex} value={value} onValueChange={setValue} />
        <SwatchPicker selected label="고른 색" color={PALETTE[6].hex} value={PALETTE[6].hex} onValueChange={() => {}} />
      </Inline>
    )
  },
}
