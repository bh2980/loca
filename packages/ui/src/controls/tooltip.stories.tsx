import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Button } from "./button"
import { HelpTip, Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

const meta = { title: "Controls/Tooltip", component: Tooltip } satisfies Meta<typeof Tooltip>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild><Button variant="outline">마우스를 올리세요</Button></TooltipTrigger>
      <TooltipContent>번역을 실행합니다</TooltipContent>
    </Tooltip>
  ),
}

export const Sides: Story = {
  render: () => (
    <Inline gap="spacious" padding="spacious">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger asChild><Button variant="outline">{side}</Button></TooltipTrigger>
          <TooltipContent side={side}>{side}</TooltipContent>
        </Tooltip>
      ))}
    </Inline>
  ),
}

export const LongText: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild><Button variant="outline">긴 설명</Button></TooltipTrigger>
      <TooltipContent className="max-w-64">아주 긴 설명이 툴팁 안에서 여러 줄로 감싸집니다. 아주 긴 설명이 툴팁 안에서 여러 줄로 감싸집니다.</TooltipContent>
    </Tooltip>
  ),
}

/** A "?" beside a label whose word alone does not say enough. */
export const Help: Story = {
  render: () => <Inline gap="condensed"><Text variant="caption">자동 확정</Text><HelpTip>검수를 거치지 않고 바로 확정 상태로 옮깁니다.</HelpTip></Inline>,
}
