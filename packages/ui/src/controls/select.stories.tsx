import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../primitives/stack"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "./select"

const meta = { title: "Controls/Select", component: Select } satisfies Meta<typeof Select>
export default meta
type Story = StoryObj<typeof meta>

const Items = () => (
  <SelectContent>
    <SelectGroup>
      <SelectLabel>상태</SelectLabel>
      <SelectItem value="draft">초벌 번역</SelectItem>
      <SelectItem value="review">검수 중</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectItem value="done">완료</SelectItem>
    <SelectItem value="long">아주 긴 이름의 상태가 목록에서 어떻게 보이는지 확인하는 항목</SelectItem>
  </SelectContent>
)

export const Default: Story = {
  render: () => (
    <Select defaultValue="draft">
      <SelectTrigger aria-label="상태"><SelectValue placeholder="상태 선택" /></SelectTrigger>
      <Items />
    </Select>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["xs", "sm", "default"] as const).map((size) => (
        <Select key={size} defaultValue="draft">
          <SelectTrigger size={size} aria-label={size}><SelectValue /></SelectTrigger>
          <Items />
        </Select>
      ))}
    </Stack>
  ),
}

export const Widths: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["field-xs", "field", "field-xl", "menu-xl"] as const).map((width) => (
        <Select key={width} defaultValue="draft">
          <SelectTrigger width={width} aria-label={width}><SelectValue /></SelectTrigger>
          <Items />
        </Select>
      ))}
    </Stack>
  ),
}

export const Bare: Story = {
  render: () => (
    <Select defaultValue="draft">
      <SelectTrigger bare aria-label="상태"><SelectValue /></SelectTrigger>
      <Items />
    </Select>
  ),
}

export const Placeholder: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="상태"><SelectValue placeholder="상태 선택" /></SelectTrigger>
      <Items />
    </Select>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Select defaultValue="draft" disabled>
      <SelectTrigger aria-label="상태"><SelectValue /></SelectTrigger>
      <Items />
    </Select>
  ),
}

export const Invalid: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-invalid aria-label="상태"><SelectValue placeholder="필수 선택" /></SelectTrigger>
      <Items />
    </Select>
  ),
}

/** The value truncates inside a narrow trigger. */
export const LongText: Story = {
  render: () => (
    <Select defaultValue="long">
      <SelectTrigger width="field-xl" aria-label="상태"><SelectValue /></SelectTrigger>
      <Items />
    </Select>
  ),
}

export const Open: Story = {
  render: () => (
    <Select defaultValue="draft" defaultOpen>
      <SelectTrigger aria-label="상태"><SelectValue /></SelectTrigger>
      <Items />
    </Select>
  ),
}
