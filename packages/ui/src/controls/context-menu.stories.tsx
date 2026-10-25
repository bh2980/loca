import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Text } from "../primitives/text"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "./context-menu"

const meta = { title: "Controls/ContextMenu" } satisfies Meta
export default meta
type Story = StoryObj

/** Right-click the box. */
export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger>
        <Box padding="spacious" border="all" radius="md"><Text variant="caption" tone="muted">여기를 우클릭하세요</Text></Box>
      </ContextMenuTrigger>
      <ContextMenuContent width="menu-xl">
        <ContextMenuLabel>대사</ContextMenuLabel>
        <ContextMenuItem>복사<ContextMenuShortcut>Ctrl C</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem disabled>붙여넣기</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">삭제</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const DisabledTrigger: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger disabled>
        <Box padding="spacious" border="all" radius="md"><Text variant="caption" tone="muted">우클릭해도 열리지 않습니다</Text></Box>
      </ContextMenuTrigger>
      <ContextMenuContent><ContextMenuItem>복사</ContextMenuItem></ContextMenuContent>
    </ContextMenu>
  ),
}
