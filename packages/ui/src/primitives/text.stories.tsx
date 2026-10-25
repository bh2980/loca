import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inbox } from "lucide-react"
import { Inline, Stack } from "../layout/stack"
import { Heading, Text } from "./text"
import { Icon } from "./icon"

const meta = {
  title: "Layout/Text and Heading",
  component: Text,
  args: { children: "처음 번역하는 장면", variant: "body", tone: "default" },
} satisfies Meta<typeof Text>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** With no variant, a Text keeps the size around it: only the named options are added. */
export const OnlyWhatIsNamed: Story = {
  render: () => (
    <Text as="p" variant="body">
      본문 안에서 <Text tone="muted">흐린 말</Text>, <Text weight="medium">굵은 말</Text>, <Text mono>code_key</Text>, <Text tabular>1,234</Text>를 쓴다.
    </Text>
  ),
}

export const Truncation: Story = {
  render: () => (
    <Stack gap="condensed" style={{ width: 220 }}>
      <Text truncate>이 문장은 한 줄을 넘으면 말줄임표로 줄어듭니다. 이 문장은 한 줄을 넘으면.</Text>
      <Text lines={2} display="block">이 문장은 두 줄까지만 보이고 그 뒤는 말줄임표로 줄어듭니다. 이 문장은 두 줄까지만 보이고 그 뒤는 줄어듭니다.</Text>
      <Text preserveLines display="block">{"줄바꿈을\n그대로 둡니다"}</Text>
    </Stack>
  ),
}

/** The four heading roles; SectionHeading, GroupHeading and PageTitle are thin wrappers of these. */
export const Headings: Story = {
  render: () => (
    <Stack gap="condensed">
      <Heading as="h1" variant="page">프로젝트 홈 (page)</Heading>
      <Heading variant="page-section">번역 진행 (page-section)</Heading>
      <Heading variant="section">상태 (section)</Heading>
      <Heading as="h3" variant="group">검토 필요 (group)</Heading>
    </Stack>
  ),
}

/** An icon takes its size, color and turning by name; no wrapper element. */
export const Icons: Story = {
  render: () => (
    <Inline gap="condensed">
      <Icon icon={Inbox} />
      <Icon icon={Inbox} size="sm" tone="muted" />
      <Icon icon={Inbox} size="xs" tone="danger" />
      <Text variant="caption" tone="muted">기본 · sm · xs</Text>
    </Inline>
  ),
}
