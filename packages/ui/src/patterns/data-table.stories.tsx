import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { useState } from "react"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { DataTable, type ColumnDef } from "./data-table"
import { EmptyState } from "./empty-state"
import { StatusIcon } from "./status"

const meta = { title: "Patterns/DataTable", decorators: [(Story) => <Box style={{ width: 720 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

type Line = { id: string; speaker: string; source: string; target: string; status: "untranslated" | "translated" | "review" | "done"; chars: number }

const LINES: Line[] = [
  { id: "12-001", speaker: "하윤", source: "おはよう、ミンジェ。", target: "안녕, 민재.", status: "done", chars: 7 },
  { id: "12-002", speaker: "민재", source: "また遅刻か?", target: "또 지각이야?", status: "translated", chars: 8 },
  { id: "12-003", speaker: "하윤", source: "うるさい。屋上に行こう。", target: "시끄러워. 옥상으로 가자.", status: "review", chars: 14 },
  { id: "12-004", speaker: "선생님", source: "授業が始まっていますよ、二人とも席に戻りなさい。早く。", target: "", status: "untranslated", chars: 0 },
]

const STATUS = {
  untranslated: { color: PALETTE[0].hex, kind: "initial" as const },
  translated: { color: PALETTE[8].hex, kind: "normal" as const },
  review: { color: PALETTE[2].hex, kind: "normal" as const, inReview: true },
  done: { color: PALETTE[5].hex, kind: "final" as const },
}

const columns: ColumnDef<Line, unknown>[] = [
  { id: "id", header: "번호", accessorKey: "id", meta: { width: 80, mono: true, tone: "muted", variant: "caption", hideable: false } },
  { id: "status", header: "상태", meta: { width: 56, resizable: false, label: "상태" }, cell: ({ row }) => <StatusIcon status={STATUS[row.original.status]} label={row.original.status} small /> },
  { id: "speaker", header: "화자", accessorKey: "speaker", meta: { width: 90, weight: "medium" } },
  { id: "source", header: "원문", accessorKey: "source", meta: { width: 220, wrap: true } },
  { id: "target", header: "번역", accessorKey: "target", meta: { wrap: true } },
  { id: "chars", header: "글자", accessorKey: "chars", meta: { width: 70, align: "end", tabular: true, tone: "muted" } },
]

const rowId = (row: Line) => row.id

/** Plain: columns with a starting width share the row; the last one takes what is left. */
export const Default: Story = {
  render: () => <DataTable columns={columns} rows={LINES} rowId={rowId} compact />,
}

/** `selected` marks the open row; a click on a row calls `onRowClick`. */
export const Selected: Story = {
  render: () => {
    const [selected, setSelected] = useState<string | undefined>("12-003")
    return <DataTable columns={columns} rows={LINES} rowId={rowId} compact selected={selected} onRowClick={(row) => setSelected(row.id)} />
  },
}

/** Checkboxes pick rows; with some picked the header turns into the `bulk` actions. `canPick` leaves some rows without one. */
export const Picking: Story = {
  render: () => {
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(["12-002", "12-003"]))
    return (
      <DataTable
        columns={columns}
        rows={LINES}
        rowId={rowId}
        compact
        picked={picked}
        canPick={(row) => row.id !== "12-001"}
        onPick={(ids, on) => setPicked((previous) => { const next = new Set(previous); ids.forEach((id) => (on ? next.add(id) : next.delete(id))); return next })}
        bulk={<Button variant="outline">번역</Button>}
      />
    )
  },
}

/** Rows that are not settled yet get a dashed warning edge. */
export const TentativeRows: Story = {
  render: () => <DataTable columns={columns} rows={LINES} rowId={rowId} compact rowState={(row) => (row.status === "review" ? "tentative" : undefined)} />,
}

/** Small tables can be reordered by the grip in the first cell (`reorderable` leaves rows that cannot move). */
export const Reorderable: Story = {
  render: () => {
    const [rows, setRows] = useState(LINES)
    return (
      <DataTable
        columns={columns}
        rows={rows}
        rowId={rowId}
        compact
        rowLabel={(row) => row.id}
        reorderable={(row) => row.id !== "12-001"}
        onReorder={(ids) => setRows((previous) => ids.map((id) => previous.find((row) => row.id === id)!))}
      />
    )
  },
}

/** With an `id` the table remembers column widths and order, and shows the 열 고르기 menu at the right of the header. */
export const ColumnMenu: Story = {
  render: () => <DataTable id="story-lines" columns={columns} rows={LINES} rowId={rowId} compact />,
}

/** The loading state is a set of skeleton rows. */
export const Loading: Story = {
  render: () => <DataTable columns={columns} rows={undefined} rowId={rowId} compact loading />,
}

/** Nothing yet; and nothing after a filter. */
export const Empty: Story = {
  render: () => (
    <Box>
      <DataTable columns={columns} rows={[]} rowId={rowId} compact />
      <DataTable columns={columns} rows={[]} rowId={rowId} compact empty={<EmptyState noun="줄" filtered />} />
    </Box>
  ),
}

/** Cell text is cut with an ellipsis unless the column says `wrap`. */
export const LongText: Story = {
  render: () => {
    const long: Line[] = [{ ...LINES[3], speaker: "아주 긴 이름의 화자는 잘립니다", source: LINES[3].source.repeat(3), target: "수업이 시작됐어요, 두 사람 모두 자리로 돌아가세요. 어서요. ".repeat(3) }]
    return <DataTable columns={columns} rows={long} rowId={rowId} compact />
  },
}

/** `footer` sits under the rows. */
export const Footer: Story = {
  render: () => <DataTable columns={columns} rows={LINES} rowId={rowId} compact footer={<Box padding="condensed">총 4줄</Box>} />,
}

/** Over 80 rows the table scrolls virtually: only the visible rows exist. It fills its parent unless `compact`. */
export const Many: Story = {
  render: () => {
    const rows: Line[] = Array.from({ length: 9000 }, (_, index) => ({ ...LINES[index % 4], id: `L-${String(index + 1).padStart(4, "0")}` }))
    return <Box style={{ height: 360, display: "flex" }}><DataTable columns={columns} rows={rows} rowId={rowId} /></Box>
  },
}
