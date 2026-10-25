import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../primitives/box"
import { PermissionMatrix } from "./permission-matrix"

const meta = { title: "Patterns/PermissionMatrix", decorators: [(Story) => <Box style={{ width: 720 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

type Row = "lines" | "terms" | "characters" | "graph"
type Action = "read" | "propose" | "write"
const ACTIONS = [{ id: "read", label: "읽기" }, { id: "propose", label: "제안" }, { id: "write", label: "쓰기" }] as const
const ROWS = [
  { id: "lines", label: "대본 줄", description: "원문과 번역", supported: ["read", "propose", "write"] },
  { id: "terms", label: "용어집", supported: ["read", "propose"] },
  { id: "characters", label: "인물", description: "이름·말투·관계", supported: ["read", "propose"] },
  { id: "graph", label: "대화 그래프", supported: ["read"] },
] as const

const Demo = ({ disabled = false }: { disabled?: boolean }) => {
  const [on, setOn] = useState<Record<string, boolean>>({ "lines:read": true, "terms:read": true, "terms:propose": true })
  return (
    <PermissionMatrix<Row, Action>
      actions={ACTIONS}
      rows={ROWS}
      disabled={disabled}
      checked={(row, action) => Boolean(on[`${row}:${action}`])}
      onChange={(row, action, value) => setOn((previous) => ({ ...previous, [`${row}:${action}`]: value }))}
    />
  )
}

/** A row without an action shows "—" (not supported). */
export const Default: Story = { render: () => <Demo /> }

export const Disabled: Story = { render: () => <Demo disabled /> }

export const Empty: Story = {
  render: () => <PermissionMatrix<Row, Action> actions={ACTIONS} rows={[]} checked={() => false} onChange={() => {}} />,
}
