import type { Meta, StoryObj } from "@storybook/react-vite"
import { Paperclip, ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react"
import { useState } from "react"
import { Box } from "../../primitives/box"
import { Inline, Stack } from "../../primitives/stack"
import { Button } from "../../controls/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "../../controls/dropdown-menu"
import { AttachmentChip } from "./attachment-chip"
import { ComposerInput, ComposerMenu, type ComposerGroup } from "./composer"
import { ContextMeterView } from "./context-meter"
import { ConversationRowAction } from "./conversation-menu"
import { ModeSelect } from "./select"
import { ListRow } from "../../patterns/list-row"
import { MenuLabel } from "../../patterns/menu-label"
import { MenuSearchField } from "../../controls/search-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../controls/select"
import { Icon } from "../../primitives/icon"
import { Text } from "../../primitives/text"
import { History, Pencil, Trash2 } from "lucide-react"

const meta = { title: "Domains/Chat/Composer" } satisfies Meta
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

const GROUPS: ComposerGroup[] = [
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
    <Box border="top" background="page" padding="condensed" style={{ width: 380 }}>
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
  return (
    <Select value={kind} onValueChange={setKind}>
      <SelectTrigger width="field" aria-label="종류 필터"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">모든 종류</SelectItem>
        <SelectItem value="save_character">인물 저장</SelectItem>
        <SelectItem value="save_terms">용어 저장</SelectItem>
      </SelectContent>
    </Select>
  )
}

/** The conversation list: the current one, a row with its hover actions, a search hit. */
export const ConversationList: Story = {
  render: () => (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" minWidth={0} grow justifyContent="start"><Icon icon={History} tone="muted" /><Text truncate>1장 말투 정리</Text></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="popover">
        <MenuLabel tone="strong">대화</MenuLabel>
        <MenuSearchField placeholder="제목·내용으로 대화 찾기" aria-label="대화 검색" />
        <ListRow as="menuitem" selected>
          <Text minWidth={0} grow truncate>1장 말투 정리</Text>
          <Text shrink={false} variant="caption" tone="muted" tabular>12건 · 48k</Text>
          <ConversationRowAction aria-label="이름 바꾸기"><Pencil /></ConversationRowAction>
          <ConversationRowAction danger aria-label="삭제"><Trash2 /></ConversationRowAction>
        </ListRow>
        <ListRow as="menuitem"><Text minWidth={0} grow truncate>용어집 정리</Text></ListRow>
        <ListRow as="menuitem" stacked>
          <Text width="full" truncate>인물 관계 추출</Text>
          <Text width="full" variant="caption" weight="normal" tone="muted" truncate>하윤과 민재는 같은 반 친구로…</Text>
        </ListRow>
        <DropdownMenuSeparator />
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** The chat box's text field: empty, with a long message (it grows, then scrolls), and disabled while a request is sent. */
export const ComposerInputStates: Story = {
  render: () => (
    <Stack gap="condensed" style={{ width: 380 }}>
      <ComposerInput aria-label="메시지" placeholder="메시지" value="" onChange={() => {}} />
      <ComposerInput aria-label="메시지" value={"1장 옥상 장면의 하윤 말투를 정리해 줘.\n".repeat(12)} onChange={() => {}} />
      <ComposerInput aria-label="메시지" placeholder="보내는 중…" disabled value="" onChange={() => {}} />
    </Stack>
  ),
}

/** The mode picker: fixed width, disabled, and the warning color of a mode that skips safeguards. */
export const ModeSelectEdges: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <ModeSelect value="auto" icon={ShieldCheck} width="medium" label="변경 권한 모드" onValueChange={() => {}} options={MODES} />
      <ModeSelect value="auto" icon={ShieldCheck} disabled label="변경 권한 모드" onValueChange={() => {}} options={MODES} />
      <ModeSelect value="bypass" icon={ShieldOff} warn label="변경 권한 모드" onValueChange={() => {}} options={MODES} />
    </Stack>
  ),
}
