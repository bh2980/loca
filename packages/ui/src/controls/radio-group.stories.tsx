import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline, Stack } from "../primitives/stack"
import { Label } from "./label"
import { RadioGroup, RadioGroupItem } from "./radio-group"

const meta = { title: "Controls/RadioGroup", component: RadioGroup } satisfies Meta<typeof RadioGroup>
export default meta
type Story = StoryObj<typeof meta>

const Options = ({ disabled }: { disabled?: boolean }) => (
  <>
    {[["a", "원문 그대로"], ["b", "번역 우선"], ["c", "아주 긴 설명이 붙은 선택지는 좁은 폭에서 여러 줄로 감싸집니다"]].map(([value, label]) => (
      <Inline key={value} gap="condensed" align="start"><RadioGroupItem id={`r-${value}-${disabled}`} value={value} disabled={disabled} /><Label htmlFor={`r-${value}-${disabled}`}>{label}</Label></Inline>
    ))}
  </>
)

export const Default: Story = { render: () => <RadioGroup defaultValue="a"><Options /></RadioGroup> }
export const Disabled: Story = { render: () => <RadioGroup defaultValue="b"><Options disabled /></RadioGroup> }
export const Invalid: Story = { render: () => <RadioGroup aria-invalid><Options /></RadioGroup> }
export const LongText: Story = { render: () => <Stack width="field-lg"><RadioGroup defaultValue="c"><Options /></RadioGroup></Stack> }
