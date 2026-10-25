import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../primitives/box"
import { ColumnMenu, type ColumnItem } from "./column-menu"

const meta = { title: "Patterns/ColumnMenu", decorators: [(Story) => <Box style={{ width: 360, minHeight: 320 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const ITEMS: ColumnItem[] = [
  { id: "name", label: "이름", shown: true, hideable: false },
  { id: "status", label: "상태", shown: true, hideable: true },
  { id: "speaker", label: "화자", shown: false, hideable: true },
  { id: "source", label: "아주 긴 이름의 열은 한 줄에서 말줄임표로 잘립니다 아주 긴 이름", shown: true, hideable: true },
]

/** Click the icon: drag the grips (or Space then ↑↓) to reorder, tick to show, 기본으로 resets. A column that is not `hideable` has its tick locked. */
export const Default: Story = {
  render: () => {
    const [items, setItems] = useState(ITEMS)
    return (
      <ColumnMenu
        items={items}
        onReorder={(ids) => setItems((previous) => ids.map((id) => previous.find((item) => item.id === id)!))}
        onToggle={(id, shown) => setItems((previous) => previous.map((item) => (item.id === id ? { ...item, shown } : item)))}
        onReset={() => setItems(ITEMS)}
      />
    )
  },
}
