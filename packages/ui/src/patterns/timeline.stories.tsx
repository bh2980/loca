import type { Meta, StoryObj } from "@storybook/react-vite"
import { Check, Plus } from "lucide-react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Text } from "../primitives/text"
import { Chip } from "./chip"
import { Timeline, TimelineFields, TimelineNote, TimelinePoint, TimelineQuotes, TimelineStart } from "./timeline"

const meta = { title: "Patterns/Timeline", decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Changes: Story = {
  render: () => (
    <Box spaceY="normal">
      <TimelineStart title="기본 말투 · 처음부터" counts="처음 ~ c3.turn.025 전 · 적용 12줄" actions={<Button variant="ghost" size="inline">편집</Button>}>
        <Text weight="medium">해요체</Text> <Text tone="muted">호칭 “리브 씨”</Text>
        <TimelineNote>처음 만난 사이라 거리를 둡니다.</TimelineNote>
      </TimelineStart>
      <Timeline label="바뀌는 지점">
        <TimelinePoint title="c3.turn.025부터" meta="The Mooring Ledger" status={<Chip variant="quiet">확정</Chip>} counts="적용 8줄" actions={<Button variant="ghost" size="inline">편집</Button>}>
          <TimelineFields items={[{ label: "말투", before: "해요체", after: "해체(반말)" }]} />
          <TimelineNote>장부 일 이후 가까워졌습니다.</TimelineNote>
          <TimelineQuotes items={[{ id: "1", label: "c3.turn.025", text: "Then stop calling me sir." }]} />
        </TimelinePoint>
        <TimelinePoint mark="candidate" title="c3.dawn.006부터" meta="Dawn" status={<Chip variant="outline" tone="warning">후보</Chip>} counts="적용 3줄" actions={<><Button variant="ghost" size="inline" tone="danger">버리기</Button><Button size="inline"><Check /> 확정</Button></>}>
          <TimelineFields items={[{ label: "호칭", before: "리브 씨", after: "리브" }]} />
        </TimelinePoint>
        <TimelinePoint mark="add">
          <Button variant="ghost"><Plus /> 변화 추가</Button>
        </TimelinePoint>
      </Timeline>
    </Box>
  ),
}
