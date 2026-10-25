import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { Button } from "../controls/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../controls/dropdown-menu"
import { Box } from "../primitives/box"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { ListRow } from "./list-row"
import { Meter } from "./meter"

const meta = { title: "Patterns/ListRow", decorators: [(Story) => <Box style={{ width: 320 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** `as="li"` (default): a row of an inspector list; `density` tight or loose. */
export const Plain: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Box as="ul" divide="y">
        <ListRow><Text>하윤 · 12-004</Text></ListRow>
        <ListRow><Text>민재 · 12-005</Text></ListRow>
      </Box>
      <Box as="ul" divide="y">
        <ListRow density="loose">하윤 · 12-004</ListRow>
        <ListRow density="loose">민재 · 12-005</ListRow>
      </Box>
    </Stack>
  ),
}

/** `choice`: a row that is picked; `selected` marks the open one, `flagged` a match. */
export const Choice: Story = {
  render: () => (
    <Box as="ul">
      <ListRow variant="choice">고르지 않은 줄</ListRow>
      <ListRow variant="choice" selected>열려 있는 줄</ListRow>
      <ListRow variant="choice" flagged>일치하는 줄</ListRow>
    </Box>
  ),
}

/** `as="link"`: the one child (a router link) becomes the row. */
export const Links: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Stack gap="hair">
        <ListRow as="link" variant="menu"><a href="#a"><span>메뉴 줄</span><span>12</span></a></ListRow>
        <ListRow as="link" variant="menu" density="loose"><a href="#a"><span>넉넉한 메뉴 줄</span><span>12</span></a></ListRow>
        <ListRow as="link" variant="menu" stacked><a href="#a"><span>세로로 쌓은 줄</span><span>어디서 찾았는지</span></a></ListRow>
        <ListRow as="link" variant="menu" tone="warning"><a href="#a"><span>살펴볼 줄</span><span>!</span></a></ListRow>
      </Stack>
      <Box border="all" radius="md" divide="y">
        <ListRow as="link" variant="bordered"><a href="#a">테두리 있는 목록의 줄</a></ListRow>
        <ListRow as="link" variant="bordered" size="sm"><a href="#a">작은 글씨의 줄</a></ListRow>
      </Box>
      <Box>
        <ListRow as="link" variant="line"><a href="#a">창 안 목록의 줄</a></ListRow>
        <ListRow as="link" variant="line" inset><a href="#a">들여 쓴 줄</a></ListRow>
      </Box>
    </Stack>
  ),
}

/** Navigation links: `active` is the open place. */
export const Navigation: Story = {
  render: () => (
    <Stack gap="hair">
      <ListRow as="link" variant="nav"><a href="#a">대본</a></ListRow>
      <ListRow as="link" variant="nav" active><a href="#a">용어집</a></ListRow>
      <Inline gap="hair"><ListRow as="link" variant="nav-section" active><a href="#a">1화</a></ListRow></Inline>
      <ListRow as="link" variant="nav-scene"><a href="#a"><span>3화 옥상</span><Meter statuses={[{ id: "s", name: "완료", color: PALETTE[5].hex, kind: "final" }]} counts={{ s: 3 }} /></a></ListRow>
      <ListRow as="link" variant="nav-scene" complete><a href="#a"><span>2화 교실 (모두 끝남)</span></a></ListRow>
    </Stack>
  ),
}

/** `as="button"`: `result` is two lines divided by a hairline (a found item); `pick` one line in body text. */
export const Buttons: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Box border="all" radius="md">
        <ListRow as="button" variant="result"><span>하윤</span><Text variant="caption" tone="muted">인물 · 12-004</Text></ListRow>
        <ListRow as="button" variant="result" disabled><span>민재</span><Text variant="caption" tone="muted">인물 · 12-005</Text></ListRow>
      </Box>
      <ListRow as="button" variant="pick">골라서 쓰는 한 줄</ListRow>
    </Stack>
  ),
}

/** `as="menuitem"`: a row of a dropdown menu (click the button); `selected` reads medium, `stacked` puts the parts one under the other. */
export const MenuItems: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline">메뉴 열기</Button></DropdownMenuTrigger>
      <DropdownMenuContent>
        <ListRow as="menuitem">보통 줄</ListRow>
        <ListRow as="menuitem" selected>지금 열린 줄</ListRow>
        <ListRow as="menuitem" stacked><span>찾은 항목</span><Text variant="caption" tone="muted">어디서 찾았는지</Text></ListRow>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const LongText: Story = {
  render: () => (
    <Stack gap="hair">
      <ListRow as="link" variant="nav"><a href="#a"><Text truncate>아주 긴 이름의 장면은 한 줄에서 말줄임표로 잘립니다 아주 긴 이름</Text></a></ListRow>
      <ListRow as="link" variant="bordered"><a href="#a">아주 긴 이름의 줄은 폭을 넘으면 다음 줄로 이어지며 높이가 늘어납니다 아주 긴 이름</a></ListRow>
    </Stack>
  ),
}
