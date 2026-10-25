import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { PaneHeader } from "./pane-header"
import { SplitPane } from "./split-pane"

const meta = { title: "Patterns/SplitPane", decorators: [(Story) => <Box style={{ width: 720, height: 280 }} border="all" radius="md"><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const Detail = ({ onClose }: { onClose?: () => void }) => (
  <Stack>
    <PaneHeader kicker="인물" title="하윤" onClose={onClose} />
    <Box padding="normal"><Text variant="body">오른쪽 상세는 끌어서 폭을 바꿉니다. 폭은 기억됩니다.</Text></Box>
  </Stack>
)

/** The content and a detail pane beside it, resizable; the pane exists only while there is a selection. */
export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <SplitPane id="story-default" fill="height" pane={open ? <Detail onClose={() => setOpen(false)} /> : null}>
        <Box padding="normal"><Text variant="body">목록</Text><Button variant="outline" onClick={() => setOpen((value) => !value)}>{open ? "닫기" : "상세 열기"}</Button></Box>
      </SplitPane>
    )
  },
}

/** No selection: the content takes all the room. */
export const Closed: Story = {
  render: () => <SplitPane id="story-closed" fill="height" pane={null}><Box padding="normal"><Text variant="body">선택이 없으면 목록이 전체를 씁니다.</Text></Box></SplitPane>,
}

/** `defaultWidth` and `minSize` set the starting width of the pane and the least width of the content. */
export const Sizes: Story = {
  render: () => (
    <SplitPane id="story-sizes" fill="height" defaultWidth="300px" minSize="400px" pane={<Detail />}>
      <Box padding="normal"><Text variant="body">상세 300px, 목록은 400px 아래로 줄지 않음</Text></Box>
    </SplitPane>
  ),
}
