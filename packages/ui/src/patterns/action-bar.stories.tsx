import type { Meta, StoryObj } from "@storybook/react-vite"
import { Copy, Languages, Pencil, Trash2 } from "lucide-react"
import { Box } from "../primitives/box"
import { Icon } from "../primitives/icon"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { ActionBar, type ActionBarItem } from "./action-bar"

const meta = { title: "Patterns/ActionBar" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const ITEMS: ActionBarItem[] = [
  { id: "translate", label: "번역", icon: <Icon icon={Languages} />, onSelect: noop },
  { id: "edit", label: "수정", icon: <Icon icon={Pencil} />, onSelect: noop },
  { id: "copy", label: "복사", icon: <Icon icon={Copy} />, onSelect: noop },
  { id: "delete", label: "삭제", icon: <Icon icon={Trash2} />, onSelect: noop, destructive: true },
]

/** Icons show when every visible item has one; a destructive item always goes into the ⋯ menu. */
export const Default: Story = { render: () => <ActionBar aria-label="줄 동작" items={ITEMS} /> }

export const WithoutIcons: Story = {
  render: () => <ActionBar aria-label="줄 동작" items={ITEMS.map(({ icon: _icon, ...item }) => item)} />,
}

/** The least important items move into ⋯ first when the room is short (`priority`, lower goes first); `overflow` forces it. */
export const Overflow: Story = {
  render: () => (
    <Stack gap="comfortable">
      {[420, 240, 120].map((width) => (
        <Box key={width} style={{ width }} border="all" padding="tight">
          <Text variant="micro" tone="muted">{width}px</Text>
          <ActionBar aria-label={`줄 동작 ${width}`} items={ITEMS} />
        </Box>
      ))}
    </Stack>
  ),
}

export const Priority: Story = {
  render: () => (
    <Box style={{ width: 200 }} border="all" padding="tight">
      <ActionBar
        aria-label="우선순위"
        items={[
          { id: "a", label: "먼저 접힘", onSelect: noop, priority: 0 },
          { id: "b", label: "나중에 접힘", onSelect: noop, priority: 5 },
          { id: "c", label: "접히지 않음", onSelect: noop, overflow: "never" },
        ]}
      />
    </Box>
  ),
}

export const AlwaysInMenu: Story = {
  render: () => <ActionBar aria-label="메뉴" items={[{ id: "run", label: "실행", onSelect: noop }, { id: "rename", label: "이름 바꾸기", onSelect: noop, overflow: "always" }]} />,
}

export const Disabled: Story = {
  render: () => <ActionBar aria-label="비활성" items={ITEMS.map((item) => ({ ...item, disabled: true }))} />,
}
