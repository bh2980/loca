import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Text } from "../primitives/text"
import { useState } from "react"
import { Button } from "./button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger, PointMenu } from "./context-menu"

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
      <ContextMenuContent width="menu-lg">
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

function AtPoint() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <Button variant="outline" onClick={(event) => setAt({ x: event.clientX, y: event.clientY })}>누른 자리에 메뉴 열기</Button>
      <PointMenu at={at} onClose={() => setAt(null)}>
        <ContextMenuContent width="menu">
          <ContextMenuItem>상세 열기</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive">삭제</ContextMenuItem>
        </ContextMenuContent>
      </PointMenu>
    </>
  )
}

/** `PointMenu`: the screen holds where the menu opens (a canvas reports the right-click). */
export const AtAPoint: Story = { render: () => <AtPoint /> }
