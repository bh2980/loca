import type { Meta, StoryObj } from "@storybook/react-vite"
import { Search, X } from "lucide-react"
import { Stack } from "../primitives/stack"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group"

const meta = { title: "Controls/InputGroup", component: InputGroup } satisfies Meta<typeof InputGroup>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon><Search /></InputGroupAddon>
      <InputGroupInput placeholder="용어 검색" />
    </InputGroup>
  ),
}

export const Addons: Story = {
  render: () => (
    <Stack gap="condensed">
      <InputGroup>
        <InputGroupInput placeholder="끝에 버튼" />
        <InputGroupAddon align="inline-end"><InputGroupButton aria-label="지우기"><X /></InputGroupButton></InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon>https://</InputGroupAddon>
        <InputGroupInput placeholder="주소" />
      </InputGroup>
    </Stack>
  ),
}

export const ButtonSizes: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["xs", "sm", "icon-xs", "icon-sm"] as const).map((size) => (
        <InputGroup key={size}>
          <InputGroupInput placeholder={size} />
          <InputGroupAddon align="inline-end"><InputGroupButton size={size} aria-label={size}>{size.startsWith("icon") ? <X /> : "적용"}</InputGroupButton></InputGroupAddon>
        </InputGroup>
      ))}
    </Stack>
  ),
}

export const Disabled: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon><Search /></InputGroupAddon>
      <InputGroupInput disabled defaultValue="비활성" />
    </InputGroup>
  ),
}

export const Invalid: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon><Search /></InputGroupAddon>
      <InputGroupInput aria-invalid defaultValue="잘못된 값" />
    </InputGroup>
  ),
}

export const LongText: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon><Search /></InputGroupAddon>
      <InputGroupInput defaultValue="아주 긴 검색어가 입력되어 그룹의 너비를 넘어가는 경우에도 한 줄로 유지됩니다 아주 긴 검색어" />
    </InputGroup>
  ),
}
