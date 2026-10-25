import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bell } from "lucide-react"
import { Box } from "../../primitives/box"
import { Icon } from "../../primitives/icon"
import { Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { DockPane, StatusBarButton } from "./app-shell"
import { ShortcutSection } from "./app-shortcuts"
import { AppStatusBar, STATUS_BAR_SLOT_ID, StatusBarItem } from "./app-status-bar"

const meta = { title: "Domains/App/Shell", decorators: [(Story) => <Box style={{ width: 520 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The right dock: the shown pane fills it; the other stays mounted but hidden. */
export const DockPanes: Story = {
  render: () => (
    <Box border="all" borderColor="default" radius="md" style={{ height: 120, display: "flex", flexDirection: "column" }}>
      <DockPane active><Box padding="normal"><Text>프로젝트 채팅 (보이는 칸)</Text></Box></DockPane>
      <DockPane active={false}><Box padding="normal"><Text>제안 목록 (숨은 칸)</Text></Box></DockPane>
    </Box>
  ),
}

/** The status bar with buttons, a long one, and an item put in from elsewhere through the slot. */
export const StatusBar: Story = {
  render: () => (
    <AppStatusBar>
      <StatusBarButton>실행 2건</StatusBarButton>
      <StatusBarButton><Icon icon={Bell} size="xs" />알림 3</StatusBarButton>
      <StatusBarButton disabled>대기 없음</StatusBarButton>
      <span id={STATUS_BAR_SLOT_ID} />
      <StatusBarItem><Text variant="micro" tone="muted">저장됨</Text></StatusBarItem>
    </AppStatusBar>
  ),
}

/** Groups of shortcuts, a hairline apart; the last has none below. */
export const ShortcutSections: Story = {
  render: () => (
    <Box border="all" borderColor="default" radius="md">
      <ShortcutSection><Stack gap="tight"><Text weight="medium">이동</Text><Text variant="caption" tone="muted">Ctrl K 명령 찾기</Text></Stack></ShortcutSection>
      <ShortcutSection><Stack gap="tight"><Text weight="medium">편집</Text><Text variant="caption" tone="muted">Ctrl Enter 저장하고 다음 줄</Text></Stack></ShortcutSection>
    </Box>
  ),
}
