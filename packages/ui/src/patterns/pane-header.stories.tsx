import type { Meta, StoryObj } from "@storybook/react-vite"
import { Pencil, User } from "lucide-react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Icon } from "../primitives/icon"
import { Stack } from "../primitives/stack"
import { PaneHeader } from "./pane-header"

const meta = { title: "Patterns/PaneHeader", decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <PaneHeader title="하윤" /> }

export const AllParts: Story = {
  render: () => (
    <PaneHeader
      kicker="인물"
      title="하윤"
      subtitle="3화 옥상 장면에서 처음 등장"
      icon={<Icon icon={User} size="md" />}
      actions={<Button variant="ghost" size="icon-xs" aria-label="수정"><Pencil /></Button>}
      onClose={() => {}}
    />
  ),
}

/** Title and subtitle are cut with an ellipsis; the actions and close button keep their room. */
export const LongText: Story = {
  render: () => (
    <PaneHeader
      kicker="장면"
      title="3화 옥상에서 하윤과 민재가 다투다가 선생님이 나타나는 아주 긴 장면 이름"
      subtitle="12-004 부터 12-118 까지, 대사 114줄과 지문 20줄이 이어지는 구간"
      onClose={() => {}}
    />
  ),
}

export const Closable: Story = {
  render: () => (
    <Stack gap="comfortable">
      <PaneHeader title="닫기 없음" />
      <PaneHeader title="닫기 있음" onClose={() => {}} />
    </Stack>
  ),
}
