import type { Meta, StoryObj } from "@storybook/react-vite"
import { Paperclip, ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react"
import { useState } from "react"
import { Box } from "../layout/box"
import { Inline, Stack } from "../layout/stack"
import { Button } from "../primitives/button"
import { DropdownMenu, DropdownMenuSeparator, DropdownMenuTrigger } from "../primitives/dropdown-menu"
import { AttachmentChip } from "./attachment-chip"
import { ComposerInput, ComposerMenu, type MenuGroup } from "./composer"
import { ContextMeterView } from "./context-meter"
import { ConversationHit, ConversationItem, ConversationMenuContent, ConversationMenuHeading, ConversationMenuTrigger, ConversationRowAction, ConversationSearchField } from "./conversation-menu"
import { CompactSelect, ModeSelect } from "./select"
import { Text } from "../primitives/text"
import { Pencil, Trash2 } from "lucide-react"

const meta = { title: "Chat/Composer and menus" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Chips: Story = {
  render: () => (
    <Stack gap="condensed">
      <Text variant="caption" tone="muted">열 수 있는 칩 · 화면이 알려 준 칩(링크 없음) · 뺄 수 있는 칩</Text>
      <Stack direction="row" wrap gap="tight">
        <AttachmentChip kind="장면" label="1장 · 옥상에서" title="1장 · 옥상에서" onOpen={() => {}} openLabel="장면 1장 · 옥상에서 열기" />
        <AttachmentChip kind="인물" label="하윤" title="하윤" />
        <AttachmentChip kind="대사" label="…여기 있었구나. 한참 찾았잖아." title="…여기 있었구나. 한참 찾았잖아. 교실에도 없고" onRemove={() => {}} removeLabel="…여기 있었구나 첨부 빼기" />
      </Stack>
    </Stack>
  ),
}

const GROUPS: MenuGroup[] = [
  {
    key: "screen",
    heading: "지금 화면",
    rows: [
      { id: "screen:scene", type: "screen", tag: "장면", label: "1장 · 옥상에서" },
      { id: "screen:line", type: "screen", tag: "대사", label: "…여기 있었구나.", detail: "12-001 · 하윤" },
    ],
  },
  {
    key: "kinds",
    heading: "종류",
    rows: [
      { id: "kind:character", type: "kind", label: "인물", detail: "37명" },
      { id: "kind:scene", type: "header", label: "장면", detail: "Tab으로 이 종류만 보기" },
      { id: "item:1", type: "item", label: "2장 · 교실", detail: "대사 84줄" },
      { id: "more", type: "more", label: "더 보기", busy: true },
    ],
  },
]

/** The list over the chat box for @, with a row selected by the arrow keys. */
export const ComposerMenuOpen: Story = {
  render: function Render() {
    const [active, setActive] = useState<string | undefined>("screen:line")
    return (
      <Box position="relative" style={{ width: 380, paddingTop: 300 }}>
        <ComposerMenu id="story-menu" title="첨부할 항목" groups={GROUPS} activeId={active} onActive={setActive} onPick={() => {}} empty="찾는 항목이 없습니다." hint="↑↓ 고르기 · Enter 첨부 · Tab 종류만 보기 · Esc 닫기" />
        <ComposerInput aria-label="메시지" placeholder="메시지" value="@옥상" onChange={() => {}} />
      </Box>
    )
  },
}

export const ComposerMenuEmpty: Story = {
  render: () => (
    <Box position="relative" style={{ width: 380, paddingTop: 100 }}>
      <ComposerMenu id="story-menu-empty" title="첨부할 항목" groups={[]} activeId={undefined} onActive={() => {}} onPick={() => {}} empty="찾는 항목이 없습니다." hint="↑↓ 고르기 · Esc 닫기" />
      <ComposerInput aria-label="메시지" value="@zzz" onChange={() => {}} />
    </Box>
  ),
}

/** The footer under the box: model, permission mode, and the context meter. */
export const ComposerFooter: Story = {
  render: () => (
    <Box border="top" background="background" padding="condensed" style={{ width: 380 }}>
      <ComposerInput aria-label="메시지" placeholder="메시지" value="" onChange={() => {}} />
      <Inline gap="condensed">
        <Box minWidth={0} grow><Text variant="caption" tone="muted">모델 선택</Text></Box>
        <ModeSelect value="auto" icon={ShieldCheck} compact label="변경 권한 모드" onValueChange={() => {}} options={MODES} />
        <Inline marginLeft="auto" gap="tight">
          <ContextMeterView percent={42} level="ok"><p>마지막 답의 입력 54,000 / 문맥 창 128,000 토큰</p></ContextMeterView>
          <Button type="button" size="icon" variant="ghost" aria-label="첨부 (@)"><Paperclip /></Button>
        </Inline>
      </Inline>
    </Box>
  ),
}

export const ContextMeterLevels: Story = {
  render: () => (
    <Inline gap="normal">
      <ContextMeterView percent={42} level="ok"><p>마지막 답의 입력 54,000 / 문맥 창 128,000 토큰</p></ContextMeterView>
      <ContextMeterView percent={86} level="high"><p>가득 차면 앞 대화를 요약해 이어갑니다.</p></ContextMeterView>
      <ContextMeterView percent={97} level="full"><p>가득 차면 앞 대화를 요약해 이어갑니다.</p></ContextMeterView>
    </Inline>
  ),
}

const MODES = [
  { value: "ask", label: "하나씩 확인", description: "제안마다 카드로 물어봅니다." },
  { value: "auto", label: "자동 검토", description: "안전한 변경은 바로 반영하고 나머지는 물어봅니다." },
  { value: "bypass", label: "바로 반영", description: "묻지 않고 모두 반영합니다." },
]

export const ModeSelects: Story = {
  render: function Render() {
    const [mode, setMode] = useState("auto")
    const icon = { ask: ShieldQuestion, auto: ShieldCheck, bypass: ShieldOff }[mode as "ask"]
    return (
      <Stack gap="condensed" align="start">
        <ModeSelect value={mode} icon={icon} label="변경 권한 모드" onValueChange={setMode} options={MODES} warn={mode === "bypass"} />
        <ModeSelect value={mode} icon={icon} label="변경 권한 모드" onValueChange={setMode} options={MODES} compact warn={mode === "bypass"} />
        <CompactSelectDemo />
      </Stack>
    )
  },
}

function CompactSelectDemo() {
  const [kind, setKind] = useState("all")
  return <CompactSelect value={kind} onValueChange={setKind} label="종류 필터" options={[{ value: "all", label: "모든 종류" }, { value: "save_character", label: "인물 저장" }, { value: "save_terms", label: "용어 저장" }]} />
}

/** The conversation list: the current one, a row with its hover actions, a search hit. */
export const ConversationList: Story = {
  render: () => (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild><ConversationMenuTrigger title="1장 말투 정리" /></DropdownMenuTrigger>
      <ConversationMenuContent>
        <ConversationMenuHeading>대화</ConversationMenuHeading>
        <ConversationSearchField placeholder="제목·내용으로 대화 찾기" aria-label="대화 검색" />
        <ConversationItem current>
          <Text minWidth={0} grow truncate>1장 말투 정리</Text>
          <Text shrink={false} variant="caption" tone="muted" tabular>12건 · 48k</Text>
          <ConversationRowAction aria-label="이름 바꾸기"><Pencil /></ConversationRowAction>
          <ConversationRowAction danger aria-label="삭제"><Trash2 /></ConversationRowAction>
        </ConversationItem>
        <ConversationItem><Text minWidth={0} grow truncate>용어집 정리</Text></ConversationItem>
        <ConversationHit title="인물 관계 추출" snippet="하윤과 민재는 같은 반 친구로…" />
        <DropdownMenuSeparator />
      </ConversationMenuContent>
    </DropdownMenu>
  ),
}
