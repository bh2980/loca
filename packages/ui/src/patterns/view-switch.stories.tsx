import type { Meta, StoryObj } from "@storybook/react-vite"
import { Network, Table2 } from "lucide-react"
import { useState } from "react"
import { Icon } from "../primitives/icon"
import { ViewSwitch } from "./view-switch"

const meta = { title: "Patterns/ViewSwitch" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** What the page shows: one choice at a time, at a fixed width. */
export const Default: Story = {
  render: () => {
    const [value, setValue] = useState("table")
    return (
      <ViewSwitch label="보기" value={value} onChange={setValue} items={[{ value: "table", label: "표" }, { value: "graph", label: "그래프" }, { value: "scene", label: "장면" }]} />
    )
  },
}

export const WithIcons: Story = {
  render: () => {
    const [value, setValue] = useState("graph")
    return (
      <ViewSwitch label="보기" value={value} onChange={setValue} items={[
        { value: "table", label: "표", icon: <Icon icon={Table2} /> },
        { value: "graph", label: "그래프", icon: <Icon icon={Network} /> },
      ]} />
    )
  },
}

export const TwoLongLabels: Story = {
  render: () => {
    const [value, setValue] = useState("a")
    return <ViewSwitch label="보기" value={value} onChange={setValue} items={[{ value: "a", label: "대본 순서로 보기" }, { value: "b", label: "장면별로 묶어 보기" }]} />
  },
}
