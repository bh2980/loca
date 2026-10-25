import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Stack } from "../primitives/stack"
import { SelectionBar } from "./selection-bar"

const meta = { title: "Patterns/SelectionBar", decorators: [(Story) => <Box style={{ width: 560 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The count, the actions for the picked rows, and 선택 해제 at the end. */
export const Default: Story = {
  render: () => (
    <SelectionBar count={3} onClear={() => {}}>
      <Button variant="outline">번역</Button>
      <Button variant="ghost">상태 바꾸기</Button>
    </SelectionBar>
  ),
}

/** The primary action keeps its fill; the others lose their border. */
export const Primary: Story = {
  render: () => (
    <SelectionBar count={120} onClear={() => {}}>
      <Button>번역 실행</Button>
      <Button variant="ghost">삭제</Button>
    </SelectionBar>
  ),
}

/** The labels ("선택됨", "선택 해제") appear once the bar has room for them. */
export const Widths: Story = {
  render: () => (
    <Stack gap="comfortable">
      {[180, 320, 560].map((width) => (
        <Box key={width} style={{ width }}><SelectionBar count={9000} onClear={() => {}}><Button variant="ghost">번역</Button></SelectionBar></Box>
      ))}
    </Stack>
  ),
}

/** `grow` takes the rest of the row (a bar in the head row of a list). */
export const Grow: Story = {
  render: () => <SelectionBar count={2} grow onClear={() => {}}><Button variant="outline">번역</Button></SelectionBar>,
}

export const NoActions: Story = { render: () => <SelectionBar count={1} onClear={() => {}} /> }
