import type { Meta, StoryObj } from "@storybook/react-vite"
import { Pencil } from "lucide-react"
import { Box } from "../../primitives/box"
import { Inline, Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { Button } from "../../controls/button"
import { Checkbox } from "../../controls/checkbox"
import { Select, SelectContent, SelectItem } from "../../controls/select"
import { TooltipProvider } from "../../controls/tooltip"
import { StatusIcon, type StatusLike } from "../../patterns/status"
import { CandidateCard } from "./candidate-card"
import { SceneSectionHeader } from "./scene-section-header"
import { ScriptInlineListenerTrigger } from "./script-controls"
import { ScriptMenuAnchor, ScriptNoteMark, ScriptSourceStyle } from "./script-line-parts"
import { ScriptReadingRow } from "./script-reading-row"
import { SpeakerIdentity } from "./speaker-identity"
import { TranslationColumnHeader } from "./translation-column-header"
import { ScriptTranslationRow } from "./translation-row"

const meta = { title: "Domains/Script/Line rows", decorators: [(Story) => <TooltipProvider><Box style={{ width: 640 }}><Story /></Box></TooltipProvider>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const TRANSLATED: StatusLike = { id: "t", name: "번역함", color: "var(--hue-3)", kind: "normal" }
const REVIEW: StatusLike = { id: "r", name: "검토 필요", color: "var(--hue-5)", kind: "normal", inReview: true }
const DONE: StatusLike = { id: "d", name: "확정", color: "var(--hue-2)", kind: "final" }

export const Speakers: Story = {
  render: () => (
    <Stack gap="tight">
      <SpeakerIdentity speaker="하윤" listener="도현" color="var(--hue-3)" />
      <SpeakerIdentity speaker="하윤" />
      <SpeakerIdentity speaker={null} />
      <SpeakerIdentity speaker="아주 긴 이름을 가진 등장인물이 말하고 있습니다" listener="아주 긴 이름을 가진 듣는 사람" color="var(--hue-5)" />
    </Stack>
  ),
}

export const ColumnHeaders: Story = {
  render: () => (
    <Stack gap="condensed">
      <TranslationColumnHeader checkbox={<Checkbox />} source="원문 (일본어)" translation="번역 (한국어)" />
      <TranslationColumnHeader checkbox={<Checkbox checked />} selection={<Inline gap="condensed"><Text>3줄 선택</Text><Button variant="outline">AI로 번역</Button></Inline>} />
    </Stack>
  ),
}

const SOURCE = "…ここにいたんだ。ずっと探してたのに、教室にもいなくて。"
const TRANSLATION = "…여기 있었구나. 한참 찾았잖아, 교실에도 없고."

/** Default, open (selected), a find match, compact, and long text. */
export const TranslationRows: Story = {
  render: () => (
    <Stack gap="none">
      <ScriptTranslationRow checkbox={<Checkbox />} speaker={<SpeakerIdentity speaker="하윤" listener="도현" />} status={<StatusIcon status={TRANSLATED} />} source={SOURCE} translation={TRANSLATION} />
      <ScriptTranslationRow selected checkbox={<Checkbox checked />} speaker={<SpeakerIdentity speaker="하윤" />} status={<StatusIcon status={REVIEW} />} meta={<ScriptNoteMark note="'그녀'가 누구인지 확인 필요" />} source={SOURCE} translation={TRANSLATION} actions={<Button variant="outline">확정</Button>} />
      <ScriptTranslationRow flagged checkbox={<Checkbox />} source={SOURCE} translation={TRANSLATION} />
      <ScriptTranslationRow compact checkbox={<Checkbox />} source={SOURCE} translation={TRANSLATION} />
      <ScriptTranslationRow checkbox={<Checkbox />} source={SOURCE.repeat(4)} translation={TRANSLATION.repeat(4)} />
      <ScriptTranslationRow layout="review" checkbox={<Checkbox />} source={SOURCE} translation={TRANSLATION} />
    </Stack>
  ),
}

export const FocusRow: Story = {
  render: () => (
    <ScriptTranslationRow layout="focus" selected checkbox={<Checkbox />} speaker={<SpeakerIdentity speaker="하윤" listener="도현" />} status={<StatusIcon status={DONE} />} meta={<Text variant="caption" tone="muted">12-001</Text>} source={SOURCE} translation={TRANSLATION} actions={<Button variant="outline"><Pencil /> 고치기</Button>} />
  ),
}

/** The reading surface: statuses, the speaker without a color, selected, and without a status. */
export const ReadingRows: Story = {
  render: () => (
    <Stack gap="none">
      <ScriptReadingRow speaker="하윤" speakerColor="var(--hue-3)" listener="도현" status={TRANSLATED} statusBy="ai" source={SOURCE} translation={TRANSLATION} />
      <ScriptReadingRow speaker="하윤" status={REVIEW} statusBy="human" source={SOURCE} translation={TRANSLATION} selected />
      <ScriptReadingRow speaker={null} status={DONE} source="風が吹いた。" translation="바람이 불었다." />
      <ScriptReadingRow speaker="도현" source={SOURCE.repeat(3)} translation={TRANSLATION.repeat(3)} />
    </Stack>
  ),
}

/** The scene header: with a checkbox, without, a count, a hover action and a long title. */
export const SceneHeaders: Story = {
  render: () => (
    <Stack gap="condensed">
      <SceneSectionHeader title="1장 · 옥상에서" count="12줄" />
      <SceneSectionHeader title="1장 · 옥상에서" count="12줄" checkbox={<Checkbox />} trailing={<Button variant="ghost">이 장면만 번역</Button>} />
      <SceneSectionHeader title="아주 긴 이름의 장면: 비 오는 날 옥상에서 우연히 마주친 두 사람의 이야기" count="1,204줄" checkbox={<Checkbox checked />} />
    </Stack>
  ),
}

export const Candidates: Story = {
  render: () => (
    <Stack gap="condensed">
      <CandidateCard text={TRANSLATION} source={<Text variant="caption">AI 번역</Text>} meta="gpt-6.1-sol · 방금" action={<Button variant="outline">적용</Button>} />
      <CandidateCard current text={TRANSLATION} source={<Text variant="caption">지금 번역</Text>} />
      <CandidateCard text={TRANSLATION.repeat(4)} meta="아주 긴 출처 표시가 한 줄을 넘으면 줄어듭니다 아주 긴 출처 표시가 한 줄을 넘으면 줄어듭니다" action={<Button variant="outline">적용</Button>} />
      <CandidateCard text="출처 없는 후보" />
    </Stack>
  ),
}

/** The source text's look: the open line reads larger; narration is muted; a document reads as prose. */
export const SourceStyles: Story = {
  render: () => (
    <Stack gap="condensed">
      <ScriptSourceStyle open={false}><Text as="p">평범한 대사 줄</Text></ScriptSourceStyle>
      <ScriptSourceStyle open><Text as="p">열려 있는 대사 줄</Text></ScriptSourceStyle>
      <ScriptSourceStyle open={false} tone="narration"><Text as="p">(바람이 분다.)</Text></ScriptSourceStyle>
      <ScriptSourceStyle open tone="document"><Text as="p">문서 줄은 본문처럼 읽힙니다.</Text></ScriptSourceStyle>
    </Stack>
  ),
}

export const NoteMarkAndAnchor: Story = {
  render: () => (
    <Inline gap="normal">
      <ScriptNoteMark note="'그녀'가 누구인지 확인 필요" />
      <ScriptNoteMark note={"여러 줄 메모\n둘째 줄\n셋째 줄"} />
      <ScriptMenuAnchor x={0} y={0} />
    </Inline>
  ),
}

/** The listener select reads as text: known and unknown (warning color). */
export const ListenerTriggers: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      <Select value="a">
        <ScriptInlineListenerTrigger unknown={false} label="도현" />
        <SelectContent><SelectItem value="a">도현</SelectItem></SelectContent>
      </Select>
      <Select value="a">
        <ScriptInlineListenerTrigger unknown label="듣는 사람 모름" />
        <SelectContent><SelectItem value="a">모름</SelectItem></SelectContent>
      </Select>
    </Stack>
  ),
}

