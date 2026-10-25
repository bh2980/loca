import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline, Stack } from "../primitives/stack"
import { Label } from "./label"
import { Switch } from "./switch"

const meta = { title: "Controls/Switch", component: Switch } satisfies Meta<typeof Switch>
export default meta
type Story = StoryObj<typeof meta>

export const Sizes: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["xs", "sm", "default"] as const).map((size) => (
        <Inline key={size} gap="condensed"><Switch id={`s-${size}`} size={size} defaultChecked /><Label htmlFor={`s-${size}`}>{size}</Label></Inline>
      ))}
    </Stack>
  ),
}

export const States: Story = {
  render: () => (
    <Inline gap="comfortable">
      <Switch aria-label="꺼짐" />
      <Switch defaultChecked aria-label="켜짐" />
      <Switch disabled aria-label="비활성 꺼짐" />
      <Switch disabled defaultChecked aria-label="비활성 켜짐" />
    </Inline>
  ),
}

export const Invalid: Story = { render: () => <Switch aria-invalid aria-label="필수" /> }

export const LongText: Story = {
  render: () => (
    <Stack width="field-lg">
      <Inline gap="condensed" align="start"><Switch id="sl" /><Label htmlFor="sl">아주 긴 설명이 붙은 설정은 좁은 폭에서 여러 줄로 감싸집니다</Label></Inline>
    </Stack>
  ),
}
