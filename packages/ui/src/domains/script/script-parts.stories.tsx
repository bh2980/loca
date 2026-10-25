import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline, Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { ScriptNoteCard, ScriptReviewIssue, ScriptSceneRow } from "./script-line-parts"
import { EmptyState } from "../../patterns/empty-state"
import { Count } from "../../patterns/count"
import { ListRow } from "../../patterns/list-row"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../controls/select"

const meta = { title: "Domains/Script/Line list parts" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Hints: Story = {
  render: () => (
    <Stack gap="condensed">
      <ScriptReviewIssue issue="용어 '옥상'이 번역에 없습니다." />
      <ScriptNoteCard note="'그녀'가 누구인지 확인 필요" onClick={() => {}} />
    </Stack>
  ),
}

export const Rows: Story = {
  render: () => (
    <ul>
      <ScriptSceneRow title="1장 · 옥상에서" count="12줄" />
      <ListRow variant="choice" selected>열려 있는 줄</ListRow>
    </ul>
  ),
}

export const Bars: Story = {
  render: () => (
    <Stack gap="condensed">
      <Inline gap="condensed" shrink={false} border="bottom" background="warningFaint" paddingX="comfortable" paddingY="snug" variant="body">1장 전체에서 <Count tone="warning">3</Count> 찾는 중 <Text truncate maxWidth="label" variant="caption" tone="muted">1장 · 옥상에서</Text></Inline>
      <Select value="a"><SelectTrigger width="field-sm" fixed><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">상태</SelectItem></SelectContent></Select>
      <EmptyState variant="roomy" noun="대사" filtered />
    </Stack>
  ),
}
