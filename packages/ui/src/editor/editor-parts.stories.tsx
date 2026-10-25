import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../layout/stack"
import { Text } from "../primitives/text"
import { EditorChangedWord, EditorDiffWord, EditorPreviousDiff } from "./editor-diff"
import { EditorDraftNote, EditorInlineLabel } from "./editor-misc"
import { EditorSuggestionItems, EditorSuggestionMore, EditorSuggestionOrigin, EditorSuggestionPanel, EditorSuggestionRow } from "./editor-suggestions"
import { EditorInputBox } from "./editor-input-box"
import { EditorTermMark, EditorTokenChip, EditorTokenText } from "./editor-tokens"

const meta = { title: "Editor/Translation editor parts" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Suggestions: Story = {
  render: () => (
    <Stack gap="condensed">
      <EditorInputBox>번역을 입력하세요</EditorInputBox>
      <EditorSuggestionPanel aria-label="번역 후보">
        <EditorSuggestionItems>
          <li>
            <EditorSuggestionRow hint="Alt+Shift+1" onPick={() => {}}>
              <EditorSuggestionOrigin>같은 원문</EditorSuggestionOrigin>
              <EditorTokenText look="suggestion">…여기 있었구나. <EditorTokenChip hue="">1</EditorTokenChip></EditorTokenText>
              <Text as="p" variant="caption" tone="muted">
                <Text tone="subtle" marginRight="tight">원문 차이</Text>
                <EditorChangedWord changed>한참</EditorChangedWord>
              </Text>
            </EditorSuggestionRow>
          </li>
        </EditorSuggestionItems>
        <EditorSuggestionMore onClick={() => {}}>+2개 더보기</EditorSuggestionMore>
      </EditorSuggestionPanel>
    </Stack>
  ),
}

export const DiffAndNotes: Story = {
  render: () => (
    <Stack gap="condensed">
      <EditorPreviousDiff title="바뀐 곳">
        <EditorDiffWord change="removed">찾았잖아</EditorDiffWord> <EditorDiffWord change="added">찾았다고</EditorDiffWord> <EditorDiffWord>한참</EditorDiffWord>
      </EditorPreviousDiff>
      <Text variant="caption" tone="warning">
        <EditorInlineLabel>용어 1</EditorInlineLabel> <EditorDraftNote>초안 보관됨</EditorDraftNote> <EditorTermMark dotted>하윤</EditorTermMark>
      </Text>
    </Stack>
  ),
}
