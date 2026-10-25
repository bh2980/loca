import type { Meta, StoryObj } from "@storybook/react-vite"
import { List, Network } from "lucide-react"
import { useState } from "react"
import { Stack } from "../primitives/stack"
import { SegmentedControl } from "./segmented-control"

const meta = { title: "Controls/SegmentedControl" } satisfies Meta
export default meta
type Story = StoryObj

const ITEMS = [{ value: "all", label: "전체" }, { value: "todo", label: "미번역" }, { value: "done", label: "완료" }]

function Demo(props: Partial<Parameters<typeof SegmentedControl>[0]>) {
  const [value, setValue] = useState("all")
  return <SegmentedControl ariaLabel="보기" items={ITEMS} {...props} value={value} onChange={setValue} />
}

export const Default: Story = { render: () => <Demo /> }
export const Variants: Story = { render: () => <Stack gap="condensed">{(["default", "ghost"] as const).map((variant) => <Demo key={variant} variant={variant} />)}</Stack> }
export const Disabled: Story = { render: () => <Demo disabled /> }
export const IconOnly: Story = { render: () => <Demo items={[{ value: "all", label: <List />, name: "목록" }, { value: "todo", label: <Network />, name: "그래프" }]} /> }
/** `fill`: every segment equally wide across the container. */
export const Fill: Story = { render: () => <Stack width="menu-lg"><Demo fill /></Stack> }
export const LongText: Story = { render: () => <Stack width="menu-lg"><Demo fixed items={[{ value: "all", label: "아주 긴 이름의 보기 하나" }, { value: "todo", label: "아주 긴 이름의 보기 둘" }]} /></Stack> }
