import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../layout/box"
import { Inline, Stack } from "../layout/stack"
import { Button } from "../primitives/button"
import { Checkbox } from "../primitives/checkbox"
import { Text } from "../primitives/text"
import { ChipField, ChipSuggestionItem, ChipSuggestionList, ChipTag, ChipTextInput } from "./rules-chip"
import { RulesAddButton, RulesCountBadge, RulesInput, RulesPresetCard, RulesPresetExample, RulesPresetGrid, RulesQuietLink, RulesSampleTextarea, RulesSuggestionPanel, RulesSuggestionRow, RulesWarningBanner } from "./rules-parts"

const meta = { title: "App/Rules and chips", decorators: [(Story) => <Box style={{ width: 520 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Format rules: preset cards, a suggestion found in the script, a rule row and the sample box. */
export const FormatRules: Story = {
  render: () => (
    <Stack gap="comfortable">
      <RulesWarningBanner
        message="고치는 동안 이 항목이 다른 곳에서 바뀌었습니다. 아래는 아직 저장하지 않은 내 수정입니다."
        actions={<><Button variant="outline" size="inline" paddingX="condensed">바뀐 내용 불러오기</Button><Button variant="ghost" size="inline" paddingX="condensed">내 수정 유지</Button></>}
      />
      <RulesPresetGrid>
        <RulesPresetCard>
          <Inline gap="condensed">
            <Checkbox defaultChecked />
            <Text weight="medium" tone="default">중괄호 변수</Text>
            <RulesCountBadge endAligned>대본 1,204줄</RulesCountBadge>
          </Inline>
          <RulesPresetExample lead="대본에서 찾은 예" found={["{name}", "{0}"]} fallback="{name}" />
        </RulesPresetCard>
        <RulesPresetCard>
          <Inline gap="condensed">
            <Checkbox />
            <Text weight="medium" tone="default">HTML 태그</Text>
            <Text variant="caption" tone="subtle" marginLeft="auto">미등장</Text>
          </Inline>
          <RulesPresetExample lead="대본에서 찾은 예" found={[]} fallback="<b>굵게</b>" />
        </RulesPresetCard>
      </RulesPresetGrid>
      <RulesSuggestionPanel>
        <RulesSuggestionRow>
          <Text>@name@</Text>
          <RulesAddButton>+ 추가</RulesAddButton>
        </RulesSuggestionRow>
      </RulesSuggestionPanel>
      <Inline gap="condensed"><RulesInput role="name" placeholder="이름" /><RulesInput role="pattern" placeholder="예: @[a-z]+@" /></Inline>
      <Box spaceY="snug" radius="md" background="muted" padding="normal"><RulesSampleTextarea defaultValue="Hello {name}" /><RulesInput role="sample" placeholder="원문을 넣어 보세요" /></Box>
      <RulesQuietLink><a href="#x">지금 12줄 제외</a></RulesQuietLink>
    </Stack>
  ),
}

/** A chip field with a value, typing, and its suggestions. */
export const Chips: Story = {
  render: () => {
    const [focused, setFocused] = useState(true)
    return (
      <Box position="relative">
        <ChipField focused={focused} onClick={() => setFocused(true)}>
          <ChipTag>하윤</ChipTag>
          <ChipTextInput placeholder="이름" onBlur={() => setFocused(false)} />
        </ChipField>
        <ChipSuggestionList>
          <ChipSuggestionItem onPick={() => {}}>하윤아</ChipSuggestionItem>
        </ChipSuggestionList>
      </Box>
    )
  },
}
