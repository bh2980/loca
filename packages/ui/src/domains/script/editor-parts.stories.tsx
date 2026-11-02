import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../../primitives/box"
import { Stack } from "../../primitives/stack"
import { Chip } from "../../patterns/chip"
import { Inline } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { EditorAiSuggestion, EditorChangedWord, EditorDiffWord, EditorPreviousDiff } from "./editor-diff"
import { Check, Sparkles } from "lucide-react"
import { Button } from "../../controls/button"
import { Popover, PopoverTrigger } from "../../controls/popover"
import { Tooltip, TooltipTrigger } from "../../controls/tooltip"
import { EditorAction } from "./editor-action"
import { EditorToolbar, EditorToolbarProvider, EditorToolbarSlot } from "./editor-toolbar"
import { EditorDraftNote, EditorTermPopover } from "./editor-misc"
import { EditorSuggestionList, EditorSuggestionRow } from "./editor-suggestions"
import { EditorInputBox } from "./editor-input-box"
import { EditorSourceParagraph, EditorTermMark, EditorTokenChip, EditorTokenText, EditorTokenTip } from "./editor-tokens"

const meta = { title: "Domains/Script/Editor parts" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Suggestions: Story = {
  render: () => (
    <Stack gap="condensed">
      <EditorInputBox>번역을 입력하세요</EditorInputBox>
      <EditorSuggestionList label="번역 후보" onMore={() => {}} moreLabel="+2개 더보기">
        <li>
          <EditorSuggestionRow hint="Alt+Shift+1" onPick={() => {}}>
            <Box asChild maxWidth="full" truncate><Chip variant="outline">같은 원문</Chip></Box>
            <EditorTokenText look="suggestion">…여기 있었구나. <EditorTokenChip hue="">1</EditorTokenChip></EditorTokenText>
            <Text as="p" variant="caption" tone="muted">
              <Text tone="subtle" marginRight="tight">원문 차이</Text>
              <EditorChangedWord changed>한참</EditorChangedWord>
            </Text>
          </EditorSuggestionRow>
        </li>
      </EditorSuggestionList>
    </Stack>
  ),
}

export const DiffAndNotes: Story = {
  render: () => (
    <Stack gap="condensed">
      <EditorAiSuggestion meta="번역 실행 · gpt-test" actions={<><Button variant="outline">적용</Button><Button variant="ghost">거절</Button></>}>
        <EditorDiffWord change="removed">찾았잖아</EditorDiffWord> <EditorDiffWord change="added">찾았다고</EditorDiffWord> 한참
      </EditorAiSuggestion>
      <EditorPreviousDiff title="바뀐 곳">
        <EditorDiffWord change="removed">찾았잖아</EditorDiffWord> <EditorDiffWord change="added">찾았다고</EditorDiffWord> <EditorDiffWord>한참</EditorDiffWord>
      </EditorPreviousDiff>
      <Text variant="caption" tone="warning">
        <Inline as="span" inline gap="tight">용어 1</Inline> <EditorDraftNote>저장 안 한 수정 · 이 브라우저에 보관됨</EditorDraftNote> <EditorTermMark dotted>하윤</EditorTermMark>
      </Text>
    </Stack>
  ),
}

/** The editor's action buttons: primary and secondary. */
export const Actions: Story = {
  render: () => (
    <Inline gap="condensed">
      <EditorAction icon={Check}>확정</EditorAction>
      <EditorAction icon={Sparkles} variant="outline">AI로 다시</EditorAction>
      <EditorAction icon={Check} disabled>확정</EditorAction>
    </Inline>
  ),
}

/** Source text: its paragraphs keep their breaks and wrap long words; a term underlined solid or dotted; a format token with its tip. */
export const SourceText: Story = {
  render: () => (
    <Stack gap="condensed" style={{ width: 360 }}>
      <EditorSourceParagraph>{"…여기 있었구나.\n한참 찾았잖아. 교실에도 없고"}</EditorSourceParagraph>
      <EditorSourceParagraph>{"https://example.com/아주아주아주아주아주아주아주아주아주아주긴주소/index.html"}</EditorSourceParagraph>
      <Text as="p">
        <EditorTermMark pickable>하윤</EditorTermMark>이 <EditorTermMark dotted>옥상</EditorTermMark>에 있다 <Tooltip open><TooltipTrigger asChild><EditorTokenChip hue="" pickable>1</EditorTokenChip></TooltipTrigger><EditorTokenTip text="{name}" hint="누르면 커서에 넣습니다" /></Tooltip>
      </Text>
    </Stack>
  ),
}

/** Format tokens: normal, stray (the source lacks it), missing (the translation lacks it), pickable. */
export const TokenChips: Story = {
  render: () => (
    <Inline gap="condensed">
      <EditorTokenChip hue="">1</EditorTokenChip>
      <EditorTokenChip hue="" stray>2</EditorTokenChip>
      <EditorTokenChip hue="" missing>3</EditorTokenChip>
      <EditorTokenChip hue="" pickable>4</EditorTokenChip>
    </Inline>
  ),
}

/** The term popover and the filter toolbar slot. */
export const PopoverAndToolbar: Story = {
  render: () => (
    <EditorToolbarProvider>
      <Stack gap="normal" align="start">
        <EditorToolbarSlot />
        <EditorToolbar><Chip variant="outline">상태: 번역함</Chip></EditorToolbar>
        <Popover open>
          <PopoverTrigger asChild><Button variant="outline">옥상</Button></PopoverTrigger>
          <EditorTermPopover><Text>'옥상'을 용어로 추가할까요?</Text><Button>추가</Button></EditorTermPopover>
        </Popover>
      </Stack>
    </EditorToolbarProvider>
  ),
}
