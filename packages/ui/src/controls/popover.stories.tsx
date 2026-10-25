import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Button } from "./button"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "./popover"

const meta = { title: "Controls/Popover", component: Popover } satisfies Meta<typeof Popover>
export default meta
type Story = StoryObj<typeof meta>

const Demo = ({ label, ...props }: { label: string } & React.ComponentProps<typeof PopoverContent>) => (
  <Popover>
    <PopoverTrigger asChild><Button variant="outline">{label}</Button></PopoverTrigger>
    <PopoverContent {...props}>
      <PopoverHeader><PopoverTitle>번역 규칙</PopoverTitle><PopoverDescription>이 줄에만 적용됩니다.</PopoverDescription></PopoverHeader>
    </PopoverContent>
  </Popover>
)

export const Default: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild><Button variant="outline">열기</Button></PopoverTrigger>
      <PopoverContent>
        <PopoverHeader><PopoverTitle>번역 규칙</PopoverTitle><PopoverDescription>이 줄에만 적용됩니다.</PopoverDescription></PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
}

export const Widths: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      {(["popover", "popover-lg", "menu-lg"] as const).map((width) => <Demo key={width} label={width} width={width} />)}
    </Stack>
  ),
}

export const Padding: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      {(["none", "condensed", "comfortable"] as const).map((padding) => <Demo key={padding} label={`padding ${padding}`} padding={padding} />)}
    </Stack>
  ),
}

/** `maxHeight` makes long content scroll. */
export const Scrolling: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild><Button variant="outline">긴 내용</Button></PopoverTrigger>
      <PopoverContent maxHeight="scroll-sm">
        <Stack gap="condensed">{Array.from({ length: 12 }, (_, index) => <Text key={index} variant="caption">규칙 {index + 1}</Text>)}</Stack>
      </PopoverContent>
    </Popover>
  ),
}

export const LongText: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild><Button variant="outline">긴 글</Button></PopoverTrigger>
      <PopoverContent width="popover"><Text variant="caption">{"아주 긴 설명이 좁은 팝오버 안에서 여러 줄로 감싸집니다. ".repeat(4)}</Text></PopoverContent>
    </Popover>
  ),
}
