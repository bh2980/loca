import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../layout/stack"
import { ScriptHintChip, ScriptListItem, ScriptNoteCard, ScriptReviewIssue, ScriptRowIdentity, ScriptSceneRow, ScriptSpeechRule, ScriptTermChip, ScriptUntranslated } from "./script-line-parts"
import { ScriptEmptyState, ScriptSelectTrigger } from "./script-controls"
import { ScriptCrumb, ScriptFindBar, ScriptMarkCount } from "./script-layout"
import { Select, SelectContent, SelectItem, SelectValue } from "../primitives/select"

const meta = { title: "Script/Line list parts" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Hints: Story = {
  render: () => (
    <Stack gap="condensed">
      <Stack direction="row" wrap gap="snug">
        <ScriptTermChip ok source="하윤" target="Hayun" onClick={() => {}} />
        <ScriptTermChip ok={false} source="옥상" target="rooftop" title="번역에 없음" onClick={() => {}} />
        <ScriptHintChip ok={false}>말투가 다릅니다</ScriptHintChip>
      </Stack>
      <ScriptSpeechRule state="kept">말투 → 친구 · 반말</ScriptSpeechRule>
      <ScriptSpeechRule state="broken">말투 → 친구 · 반말 (지금 존댓말)</ScriptSpeechRule>
      <ScriptReviewIssue issue="용어 '옥상'이 번역에 없습니다." />
      <ScriptNoteCard note="'그녀'가 누구인지 확인 필요" onClick={() => {}} />
    </Stack>
  ),
}

export const Rows: Story = {
  render: () => (
    <ul>
      <ScriptSceneRow title="1장 · 옥상에서" count="12줄" />
      <ScriptListItem selected={false}><ScriptRowIdentity found findLabel="찾음">하윤</ScriptRowIdentity><ScriptUntranslated /></ScriptListItem>
      <ScriptListItem selected flagged={false}>열려 있는 줄</ScriptListItem>
    </ul>
  ),
}

export const Bars: Story = {
  render: () => (
    <Stack gap="condensed">
      <ScriptFindBar>1장 전체에서 <ScriptMarkCount>3</ScriptMarkCount> 찾는 중 <ScriptCrumb>1장 · 옥상에서</ScriptCrumb></ScriptFindBar>
      <Select value="a"><ScriptSelectTrigger width="narrow"><SelectValue /></ScriptSelectTrigger><SelectContent><SelectItem value="a">상태</SelectItem></SelectContent></Select>
      <ScriptEmptyState noun="대사" filtered />
    </Stack>
  ),
}
