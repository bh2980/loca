import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { X } from "lucide-react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Icon } from "../primitives/icon"
import { Inline, Stack } from "../primitives/stack"
import { Chip } from "./chip"

const meta = { title: "Patterns/Chip", component: Chip } satisfies Meta<typeof Chip>
export default meta
type Story = StoryObj<typeof meta>

/** The small pills: a count, a state, a label. */
export const Pills: Story = {
  render: () => (
    <Inline gap="condensed">
      <Chip variant="solid">12</Chip>
      <Chip variant="quiet">대기 3건</Chip>
      <Chip variant="outline">초안</Chip>
      <Chip variant="plain">12-004</Chip>
    </Inline>
  ),
}

/** Tone is meaning: `solid` takes `danger`; `outline` takes muted, success, warning. */
export const Tones: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline gap="condensed"><Chip variant="solid">기본</Chip><Chip variant="solid" tone="danger">실패 2</Chip></Inline>
      <Inline gap="condensed">
        <Chip variant="outline">기본</Chip>
        <Chip variant="outline" tone="muted">비활성</Chip>
        <Chip variant="outline" tone="success">완료</Chip>
        <Chip variant="outline" tone="warning">주의</Chip>
      </Inline>
      <Inline gap="condensed">
        <Chip variant="outline" tone="success" soft>완료</Chip>
        <Chip variant="outline" tone="warning" soft>주의</Chip>
        <Chip variant="card" tone="warning">경고가 붙은 메모</Chip>
        <Chip variant="pill" tone="choice">선택지</Chip>
      </Inline>
    </Stack>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Inline gap="condensed">
      <Chip variant="quiet">default</Chip>
      <Chip variant="quiet" size="compact">compact</Chip>
      <Chip variant="quiet" size="tight">tight</Chip>
    </Inline>
  ),
}

/** A tag in its own color, as stored. */
export const Tint: Story = {
  render: () => (
    <Inline gap="condensed">
      {PALETTE.map((color) => <Chip key={color.hex} variant="tint" color={color.hex}>#{color.name}</Chip>)}
    </Inline>
  ),
}

/** One value of a chip field; `removable` ends in a button, so the end padding is trimmed. */
export const Field: Story = {
  render: () => (
    <Inline gap="condensed">
      <Chip variant="field">하윤</Chip>
      <Chip variant="field" removable>민재 <Button variant="ghost" size="icon-xs" aria-label="민재 제거"><X /></Button></Chip>
    </Inline>
  ),
}

/** A bordered note under a line, a rounded outline, and the two cards laid over a canvas. */
export const Cards: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <Chip variant="card">12-004 · 반말</Chip>
      <Chip variant="pill">장면 3</Chip>
      <Chip variant="note">옥상 장면은 존댓말에서 반말로 넘어갑니다.</Chip>
      <Chip variant="bar">선택한 3줄 <Button variant="outline">번역</Button></Chip>
      <Chip variant="bar" tone="muted" removable>연결 확인 중 <Button variant="ghost" size="icon-xs" aria-label="닫기"><X /></Button></Chip>
    </Stack>
  ),
}

/** `faint` is dimmed until hovered (a tag not picked yet). */
export const Faint: Story = {
  render: () => <Inline gap="condensed"><Chip variant="tint" color={PALETTE[6].hex} faint>#미정</Chip><Chip variant="tint" color={PALETTE[6].hex}>#정함</Chip></Inline>,
}

/** `as="button"` for a chip that is pressed (`card`, `bare`); it also takes `disabled`. */
export const Pressable: Story = {
  render: () => (
    <Inline gap="condensed">
      <Chip as="button" variant="card" onClick={() => {}}>12-004 보기</Chip>
      <Chip as="button" variant="card" disabled>12-005 보기</Chip>
      <Chip as="button" variant="bare" onClick={() => {}}><Icon icon={X} /> 닫기</Chip>
    </Inline>
  ),
}

/** The accent dot before a chip's text. */
export const Dot: Story = {
  render: () => <Chip variant="quiet"><Chip.Dot />새 소식</Chip>,
}

/** Chips never wrap their text; a long one is as wide as its text (in a narrow box it is cut by its container). */
export const LongText: Story = {
  render: () => (
    <Box style={{ width: 220 }} overflow="hidden">
      <Chip variant="quiet">아주 긴 이름의 상태 칩은 한 줄로 이어집니다</Chip>
    </Box>
  ),
}
