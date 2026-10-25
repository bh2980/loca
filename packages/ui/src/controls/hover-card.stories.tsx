import type { Meta, StoryObj } from "@storybook/react-vite"
import { Text } from "../primitives/text"
import { Button } from "./button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card"

const meta = { title: "Controls/HoverCard", component: HoverCard } satisfies Meta<typeof HoverCard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <HoverCard defaultOpen>
      <HoverCardTrigger asChild><Button variant="link">민아</Button></HoverCardTrigger>
      <HoverCardContent><Text variant="caption">주인공. 존댓말을 쓰지 않는 열여덟 살 학생.</Text></HoverCardContent>
    </HoverCard>
  ),
}

export const LongText: Story = {
  render: () => (
    <HoverCard defaultOpen>
      <HoverCardTrigger asChild><Button variant="link">설명</Button></HoverCardTrigger>
      <HoverCardContent><Text variant="caption">{"아주 긴 설명이 카드 안에서 여러 줄로 감싸집니다. ".repeat(5)}</Text></HoverCardContent>
    </HoverCard>
  ),
}
