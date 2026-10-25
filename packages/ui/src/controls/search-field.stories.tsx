import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { MenuSearchField, SearchField } from "./search-field"

const meta = { title: "Controls/SearchField" } satisfies Meta
export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<string | undefined>()
    return (
      <Stack gap="condensed">
        <SearchField value={value} onChange={setValue} placeholder="대사 검색" />
        <Text variant="caption" tone="muted">보낸 값(입력이 멈춘 뒤 250ms): {value ?? "없음"}</Text>
      </Stack>
    )
  },
}

export const Sizes: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["default", "sm", "fill"] as const).map((size) => <SearchField key={size} size={size} onChange={() => {}} placeholder={`size ${size}`} />)}
    </Stack>
  ),
}

export const WithValueAndEnd: Story = {
  render: () => <SearchField value="민아" onChange={() => {}} placeholder="대사 검색" end={<Text variant="caption" tone="muted">3/12</Text>} />,
}

export const OnCanvas: Story = {
  render: () => <SearchField onCanvas onChange={() => {}} placeholder="노드 검색" />,
}

export const LongText: Story = {
  render: () => <SearchField value="아주 긴 검색어가 입력되어 필드 너비를 넘어가는 경우" onChange={() => {}} placeholder="검색" />,
}

/** The field at the top of a menu: the text goes out as typed. */
export const Menu: Story = {
  render: () => (
    <Stack width="menu-xl" border="all" radius="md" padding="condensed">
      <MenuSearchField placeholder="필터 검색" />
    </Stack>
  ),
}
