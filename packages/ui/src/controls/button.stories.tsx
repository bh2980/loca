import type { Meta, StoryObj } from "@storybook/react-vite"
import { Plus, Trash2 } from "lucide-react"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Button } from "./button"

const meta = { title: "Controls/Button", component: Button, args: { children: "번역 실행" } } satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

const VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const
const SIZES = ["xs", "sm", "default", "lg", "inline"] as const

export const Default: Story = {}

/** One `default` (the accent) per screen or pane. */
export const Variants: Story = {
  render: () => (
    <Inline gap="condensed">
      {VARIANTS.map((variant) => <Button key={variant} variant={variant}>{variant}</Button>)}
    </Inline>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Stack gap="comfortable">
      {(["default", "outline", "ghost"] as const).map((variant) => (
        <Inline key={variant} gap="condensed">
          {SIZES.map((size) => <Button key={size} variant={variant} size={size}>{size}</Button>)}
        </Inline>
      ))}
    </Stack>
  ),
}

export const IconSizes: Story = {
  render: () => (
    <Inline gap="condensed">
      {(["icon-xs", "icon-sm", "icon", "icon-lg"] as const).map((size) => <Button key={size} variant="outline" size={size} aria-label={size}><Plus /></Button>)}
    </Inline>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Inline gap="condensed">
      <Button><Plus />용어 추가</Button>
      <Button variant="destructive"><Trash2 />삭제</Button>
      <Button variant="outline" gap="condensed"><Plus />규칙 추가</Button>
    </Inline>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Inline gap="condensed">
      {VARIANTS.map((variant) => <Button key={variant} variant={variant} disabled>{variant}</Button>)}
    </Inline>
  ),
}

export const Invalid: Story = { render: () => <Button variant="outline" aria-invalid>필수 항목 확인</Button> }

/** `size="row"` is a full-width list row that wraps. */
export const LongText: Story = {
  render: () => (
    <Stack gap="condensed" width="menu-xl">
      <Button variant="outline" size="row">이 문장은 아주 길어서 버튼 안에서 여러 줄로 감싸져야 하며 줄바꿈 후에도 정렬이 유지되어야 합니다</Button>
      <Button variant="outline" width="menu-2xs">이 문장은 아주 길어서 버튼 폭을 넘칩니다</Button>
    </Stack>
  ),
}

export const Flush: Story = {
  render: () => (
    <Stack gap="condensed">
      <Text variant="caption" tone="muted">flush=&quot;start&quot;: 글자가 주변 텍스트와 같은 선에 놓입니다</Text>
      <Button variant="ghost" flush="start">더 보기</Button>
    </Stack>
  ),
}
