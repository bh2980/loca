import type { Meta, StoryObj } from "@storybook/react-vite"
import { ArrowLeft } from "lucide-react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Icon } from "../primitives/icon"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { ViewSwitch } from "./view-switch"
import { HeaderActions, HeaderViews, Page, PageHeading } from "./page"
import { PageBody } from "./page-body"
import { PageHeader } from "./page-header"
import { Section } from "./section"

const meta = { title: "Patterns/Page", decorators: [(Story) => <Box style={{ width: 720 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const Frame = ({ children }: { children: React.ReactNode }) => <Box style={{ height: 240, display: "flex", flexDirection: "column" }} border="all" radius="md">{children}</Box>
const Content = () => <Text variant="body">페이지의 본문</Text>

/** A page with its sub-header (back, meta, actions) and the padded content area. */
export const Default: Story = {
  render: () => (
    <Frame>
      <Page back={<Button variant="ghost" size="icon-xs" aria-label="뒤로"><Icon icon={ArrowLeft} /></Button>} meta="3화 · 옥상 · 114줄" actions={<Button variant="outline">내보내기</Button>}>
        <Content />
      </Page>
    </Frame>
  ),
}

export const NoToolbar: Story = { render: () => <Frame><Page><Content /></Page></Frame> }

/** `flush`: the content has no padding (a table or a canvas); `reading`: a centered reading column; `column`: children stack and share the height. */
export const Layouts: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Frame><Page flush meta="flush"><Content /></Page></Frame>
      <Frame><Page reading meta="reading"><Content /></Page></Frame>
      <Frame><Page column meta="column"><Content /><Content /></Page></Frame>
    </Stack>
  ),
}

export const LongMeta: Story = {
  render: () => (
    <Frame>
      <Page meta="아주 긴 부제목은 한 줄에서 말줄임표로 잘립니다 아주 긴 부제목은 한 줄에서 말줄임표로 잘립니다 아주 긴 부제목" actions={<Button variant="outline">내보내기</Button>}><Content /></Page>
    </Frame>
  ),
}

/** The scrolling body of a page of forms or collections: three widths, `framed` for collections, `fill` to take the height. */
export const Body: Story = {
  render: () => (
    <Stack gap="comfortable">
      {(["compact", "default", "wide"] as const).map((width) => (
        <Frame key={width}><PageBody width={width}><Section variant="page" title={`width="${width}"`}><Content /></Section></PageBody></Frame>
      ))}
      <Frame><PageBody framed fill><Box padding="normal"><Content /></Box></PageBody></Frame>
    </Stack>
  ),
}

/** The app header: title, then the page's view tabs, then its actions. */
export const Header: Story = {
  render: () => (
    <Stack gap="comfortable">
      <PageHeader title="대본" />
      <PageHeader title="인물·관계" leading={<Button variant="ghost" size="icon-sm" aria-label="사이드바"><Icon icon={ArrowLeft} /></Button>} tools={<Button variant="ghost" size="xs">도움말</Button>} />
    </Stack>
  ),
}

/** What a page puts into the app header: views after the title, actions at the right, a heading in place of the title. */
export const HeaderSlots: Story = {
  render: () => (
    <>
      <PageHeader title="대본" />
      <HeaderViews><ViewSwitch label="보기" value="table" onChange={() => {}} items={[{ value: "table", label: "표" }, { value: "graph", label: "그래프" }]} /></HeaderViews>
      <HeaderActions><Button variant="outline">내보내기</Button></HeaderActions>
      <Text variant="caption" tone="muted">PageHeading은 PageHeader의 제목 자리를 대신합니다 (이 이야기는 한 화면에 하나만 쓰세요).</Text>
    </>
  ),
}

export const Heading: Story = {
  render: () => (
    <>
      <PageHeader title="대본" />
      <PageHeading><Text variant="body">대본 / 3화 / 옥상</Text></PageHeading>
    </>
  ),
}
