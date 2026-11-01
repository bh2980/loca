import type { Meta, StoryObj } from "@storybook/react-vite"
import { MoreHorizontal, User } from "lucide-react"
import { useState } from "react"
import { Button } from "../controls/button"
import { Input } from "../controls/input"
import { Box } from "../primitives/box"
import { Icon } from "../primitives/icon"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Chip } from "./chip"
import { Field } from "./field"
import { Inspector } from "./inspector"
import { DirtyBar } from "./inspector-dirty-bar"
import { InspectorHeader } from "./inspector-header"
import { InspectorActionRow, InspectorList, InspectorResult, InspectorToggle } from "./inspector-rows"
import { InspectorTabs } from "./inspector-tabs"
import { ListRow } from "./list-row"
import { Section } from "./section"

const meta = { title: "Patterns/Inspector", decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const Frame = ({ children }: { children: React.ReactNode }) => <Box style={{ height: 420 }}>{children}</Box>

const Body = () => (
  <>
    <Section title="기본"><Field label="이름"><Input defaultValue="하윤" /></Field></Section>
    <Section title="말투"><Text variant="body">친구에게는 반말, 선생님에게는 존댓말.</Text></Section>
  </>
)

/** Header, tabs, scrolling body, footer. */
export const Default: Story = {
  render: () => {
    const [tab, setTab] = useState("info")
    return (
      <Frame>
        <Inspector
          header={<InspectorHeader kind="인물" icon={<Icon icon={User} size="md" />} name="하윤" status={<Chip variant="quiet">주인공</Chip>} actions={<Button variant="ghost" size="icon-xs" aria-label="더보기"><MoreHorizontal /></Button>} onClose={() => {}} />}
          tabs={<InspectorTabs value={tab} onChange={setTab} items={[{ value: "info", label: "정보" }, { value: "relations", label: "관계" }, { value: "lines", label: "대사" }]} />}
          footerStart={<Button variant="ghost">삭제</Button>}
          footer={<Button>저장</Button>}
        >
          <Body />
        </Inspector>
      </Frame>
    )
  },
}

/** While loading the body is a skeleton. */
export const Loading: Story = {
  render: () => <Frame><Inspector header={<InspectorHeader name="불러오는 중" />} loading /></Frame>,
}

/** `bare`: no left rule, room to shrink (inside a pane with its own edge); `flush`: the body without padding. */
export const BareAndFlush: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Box style={{ height: 160 }}><Inspector bare header={<InspectorHeader name="bare" />}><Body /></Inspector></Box>
      <Box style={{ height: 160 }}><Inspector flush header={<InspectorHeader name="flush" />}><Text variant="body">여백 없이 닿는 본문</Text></Inspector></Box>
    </Stack>
  ),
}

export const Footers: Story = {
  render: () => (
    <Stack gap="condensed">
      <Box style={{ height: 120 }}><Inspector header={<InspectorHeader name="저장" />} footer={<Button>저장</Button>}><Body /></Inspector></Box>
      <Box style={{ height: 120 }}><Inspector header={<InspectorHeader name="버리기" />} footerStart={<Button variant="ghost">버리기</Button>} footer={<><Button variant="outline">되돌리기</Button><Button>저장</Button></>}><Body /></Inspector></Box>
      <Box style={{ height: 120 }}><Inspector header={<InspectorHeader name="삭제만" />} footerStart={<Button variant="ghost">삭제</Button>}><Body /></Inspector></Box>
    </Stack>
  ),
}

/** Name is cut with an ellipsis; `status` wraps. */
export const HeaderLongText: Story = {
  render: () => (
    <Stack gap="condensed">
      <InspectorHeader kind="장면" name="3화 옥상에서 하윤과 민재가 다투다가 선생님이 나타나는 아주 긴 장면 이름" status={<><Chip variant="quiet">검토 필요 12</Chip><Chip variant="quiet">미번역 340</Chip><Chip variant="quiet">완료 1,204</Chip><Chip variant="quiet">AI 초안 8</Chip></>} />
      <InspectorHeader name="이름만" />
    </Stack>
  ),
}

/** One tab adds no choice, so it stays hidden. */
export const Tabs: Story = {
  render: () => {
    const [tab, setTab] = useState("a")
    return (
      <Stack gap="comfortable">
        <InspectorTabs value={tab} onChange={setTab} items={[{ value: "a", label: "정보" }, { value: "b", label: "관계" }]} />
        <Text variant="caption" tone="muted">숫자는 0이어도 보이고, 점은 그 탭에 확인할 것(저장 안 한 수정, 정할 후보)이 있다는 뜻입니다. 탭은 저절로 바뀌지 않습니다:</Text>
        <InspectorTabs value={tab} onChange={setTab} items={[{ value: "a", label: "기본", attention: true }, { value: "b", label: "근거 대사", count: 0 }]} />
        <Text variant="caption" tone="muted">탭이 하나뿐이면 아무것도 보이지 않습니다:</Text>
        <InspectorTabs value="a" onChange={() => {}} items={[{ value: "a", label: "정보" }]} />
      </Stack>
    )
  },
}

/** Shows only when something changed; saving and disabled both lock the buttons. */
export const DirtyBars: Story = {
  render: () => (
    <Stack gap="condensed">
      <Box style={{ height: 120 }}><Inspector header={<InspectorHeader name="변경 없음" />} footer={<DirtyBar dirtyCount={0} onRevert={() => {}} onSave={() => {}} />}><Body /></Inspector></Box>
      <Box style={{ height: 120 }}><Inspector header={<InspectorHeader name="변경 2" />} footer={<DirtyBar dirtyCount={2} onRevert={() => {}} onSave={() => {}} />}><Body /></Inspector></Box>
      <Box style={{ height: 120 }}><Inspector header={<InspectorHeader name="저장 중" />} footer={<DirtyBar dirtyCount={2} saving onRevert={() => {}} onSave={() => {}} />}><Body /></Inspector></Box>
      <Box style={{ height: 120 }}><Inspector header={<InspectorHeader name="잠김" />} footer={<DirtyBar dirtyCount={2} disabled onRevert={() => {}} onSave={() => {}} />}><Body /></Inspector></Box>
    </Stack>
  ),
}

/** What an action gave back: ok, error, pending, info; `detail` under the status line. */
export const Results: Story = {
  render: () => (
    <Stack gap="condensed">
      <InspectorResult tone="ok">연결됨 · 142ms</InspectorResult>
      <InspectorResult tone="error" detail={<Text mono variant="caption">HTTP 401 Unauthorized</Text>}>키가 거부되었습니다.</InspectorResult>
      <InspectorResult tone="pending">확인하는 중…</InspectorResult>
      <InspectorResult tone="info">이 연결은 아직 확인하지 않았습니다.</InspectorResult>
    </Stack>
  ),
}

/** An action with its button on the right and its result underneath; rows are divided by a hairline. */
export const ActionRows: Story = {
  render: () => (
    <Box>
      <InspectorActionRow label="연결 확인" description="서버에 닿는지 확인합니다." action={<Button variant="outline">확인</Button>} result={<InspectorResult tone="ok">연결됨</InspectorResult>} />
      <InspectorActionRow label="로그인 상태" action={<Button variant="outline">다시 로그인</Button>} result={<InspectorResult tone="error">로그인이 필요합니다.</InspectorResult>} />
      <InspectorActionRow label="아주 긴 이름의 동작은 한 줄에서 말줄임표로 잘립니다 아주 긴 이름" action={<Button variant="outline">실행</Button>} />
    </Box>
  ),
}

export const Toggles: Story = {
  render: () => {
    const [on, setOn] = useState(true)
    return (
      <Stack gap="comfortable">
        <InspectorToggle label="자동 확정" description="검수를 통과하면 바로 확정합니다." help="끄면 사람이 직접 확정해야 합니다." checked={on} onChange={setOn} />
        <InspectorToggle label="꺼진 설정" checked={false} onChange={() => {}} />
        <InspectorToggle label="잠긴 설정" checked disabled onChange={() => {}} />
      </Stack>
    )
  },
}

/** A list inside a section; `body` is the body type, `scroll` the height it stops growing at. */
export const Lists: Story = {
  render: () => (
    <Stack gap="comfortable">
      <InspectorList><ListRow>하윤 · 12-004</ListRow><ListRow>민재 · 12-005</ListRow></InspectorList>
      <InspectorList body scroll="scroll-sm">
        {Array.from({ length: 12 }, (_, index) => <ListRow key={index} density="loose">12-{String(index + 1).padStart(3, "0")} 줄</ListRow>)}
      </InspectorList>
    </Stack>
  ),
}
