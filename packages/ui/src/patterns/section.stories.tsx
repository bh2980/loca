import type { Meta, StoryObj } from "@storybook/react-vite"
import { Plus } from "lucide-react"
import { Button } from "../controls/button"
import { Input } from "../controls/input"
import { Box } from "../primitives/box"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Field } from "./field"
import { Group, Section, SectionHeading } from "./section"

const meta = { title: "Patterns/Section", decorators: [(Story) => <Box style={{ width: 400 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const Body = () => <Text variant="body">하윤은 친구에게는 반말, 선생님에게는 존댓말을 씁니다.</Text>

/** A pane section: a title row, content under it, a hairline to the next. */
export const Pane: Story = {
  render: () => (
    <Box border="all" radius="md">
      <Section title="말투 규칙" actions={<Button variant="ghost" size="icon-xs" aria-label="추가"><Plus /></Button>}><Body /></Section>
      <Section><Text variant="caption" tone="muted">제목 없는 블록도 같은 여백과 구분선을 가집니다.</Text></Section>
    </Box>
  ),
}

/** `defaultOpen` makes it fold (starts open or closed); without it a pane section is plain. */
export const Collapsible: Story = {
  render: () => (
    <Box border="all" radius="md">
      <Section title="문맥" defaultOpen><Body /></Section>
      <Section title="고급" defaultOpen={false}><Body /></Section>
      <Section title="이력" collapsible actions={<Text variant="caption" tone="muted">3건</Text>}><Body /></Section>
    </Box>
  ),
}

export const LongTitle: Story = {
  render: () => (
    <Box border="all" radius="md">
      <Section title="아주 긴 섹션 제목은 한 줄에 들어가지 않으면 말줄임표로 잘리고 오른쪽 동작은 그대로 남습니다" actions={<Button variant="ghost" size="xs">편집</Button>}><Body /></Section>
    </Box>
  ),
}

/** The settings page blocks: title and description, actions at the right, `footer` for save and revert. */
export const Page: Story = {
  render: () => (
    <Stack gap="spacious">
      <Section variant="page" title="프로젝트" description="이름과 기본 언어를 정합니다." actions={<Button variant="outline">가져오기</Button>} footer={<><Button>저장</Button><Button variant="outline">되돌리기</Button></>}>
        <Field label="이름"><Input defaultValue="하윤의 여름" /></Field>
      </Section>
      <Section variant="page" title="위험 구역" description="되돌릴 수 없습니다." tone="danger" footer={<Button variant="destructive">프로젝트 삭제</Button>}>
        <Text variant="body" tone="muted">프로젝트와 모든 번역이 지워집니다.</Text>
      </Section>
    </Stack>
  ),
}

/** The three heading levels: page, section, group. */
export const Headings: Story = {
  render: () => (
    <Stack gap="comfortable">
      <SectionHeading level="page">프로젝트 홈</SectionHeading>
      <SectionHeading level="section">말투 규칙</SectionHeading>
      <SectionHeading level="group">하윤</SectionHeading>
    </Stack>
  ),
}

/** `actions` at the right, `ruled` a hairline under (the head of a popover). */
export const HeadingOptions: Story = {
  render: () => (
    <Stack gap="comfortable">
      <SectionHeading actions={<Button variant="ghost" size="xs">모두 보기</Button>}>최근 실행</SectionHeading>
      <SectionHeading ruled>필터</SectionHeading>
      <SectionHeading ruled actions={<Button variant="ghost" size="xs">지우기</Button>}>필터</SectionHeading>
    </Stack>
  ),
}

/** A titled group inside a section; `spaceY` is the space between its children. */
export const Groups: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Group title="인물"><Body /></Group>
      <Group title="관계" actions={<Button variant="ghost" size="xs">추가</Button>} spaceY="condensed"><Body /><Body /></Group>
    </Stack>
  ),
}
