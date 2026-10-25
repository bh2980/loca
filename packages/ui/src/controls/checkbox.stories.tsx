import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Inline, Stack } from "../primitives/stack"
import { Checkbox } from "./checkbox"
import { Label } from "./label"

const meta = { title: "Controls/Checkbox", component: Checkbox } satisfies Meta<typeof Checkbox>
export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline gap="condensed"><Checkbox id="c1" /><Label htmlFor="c1">선택 안 됨</Label></Inline>
      <Inline gap="condensed"><Checkbox id="c2" defaultChecked /><Label htmlFor="c2">선택됨</Label></Inline>
      <Inline gap="condensed"><Checkbox id="c3" checked="indeterminate" /><Label htmlFor="c3">일부 선택</Label></Inline>
    </Stack>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Inline gap="comfortable">
      <Checkbox disabled aria-label="비활성" />
      <Checkbox disabled defaultChecked aria-label="비활성 선택됨" />
    </Inline>
  ),
}

export const Invalid: Story = { render: () => <Checkbox aria-invalid aria-label="필수 동의" /> }

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = useState(false)
    return <Inline gap="condensed"><Checkbox id="cc" checked={checked} onCheckedChange={(value) => setChecked(value === true)} /><Label htmlFor="cc">자동 확정</Label></Inline>
  },
}

export const LongText: Story = {
  render: () => (
    <Stack width="field-xl">
      <Inline gap="condensed" align="start"><Checkbox id="cl" /><Label htmlFor="cl">아주 긴 설명이 붙은 항목은 좁은 폭에서 여러 줄로 감싸집니다</Label></Inline>
    </Stack>
  ),
}
