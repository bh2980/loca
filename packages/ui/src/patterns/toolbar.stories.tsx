import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { useState } from "react"
import { Button } from "../controls/button"
import { SearchField } from "../controls/search-field"
import { Box } from "../primitives/box"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { FilterBar, FilterChips, Pager } from "./toolbar"

const meta = { title: "Patterns/Toolbar", decorators: [(Story) => <Box style={{ width: 640 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** One-line filter row: filters on the left, count and display controls (`end`) on the right. */
export const Filter: Story = {
  render: () => {
    const [query, setQuery] = useState("")
    return (
      <FilterBar end={<Text variant="caption" tone="muted" tabular>9,000줄</Text>}>
        <SearchField value={query} onChange={(value) => setQuery(value ?? "")} placeholder="원문·번역 검색" />
        <Button variant="outline">상태</Button>
      </FilterBar>
    )
  },
}

export const FilterWithoutEnd: Story = {
  render: () => <FilterBar><Button variant="outline">상태</Button><Button variant="outline">화자</Button></FilterBar>,
}

/** The row never wraps: what does not fit is cut. */
export const FilterOverflow: Story = {
  decorators: [(Story) => <Box style={{ width: 260 }}><Story /></Box>],
  render: () => (
    <FilterBar end={<Text variant="caption" tone="muted">9,000줄</Text>}>
      <Button variant="outline">상태</Button><Button variant="outline">화자</Button><Button variant="outline">장면</Button><Button variant="outline">태그</Button>
    </FilterBar>
  ),
}

const PAGER = ({ total, initial }: { total: number; initial: number }) => {
  const [page, setPage] = useState(initial)
  return <Pager page={page} total={total} pageSize={100} onPage={setPage} />
}

/** First page (previous is off), a middle page, the last page (next is off). */
export const Pages: Story = {
  render: () => <Stack gap="comfortable"><PAGER total={9000} initial={0} /><PAGER total={9000} initial={40} /><PAGER total={9000} initial={89} /></Stack>,
}

/** One page or less renders nothing. */
export const PagerSinglePage: Story = {
  render: () => <Stack gap="condensed"><Text variant="caption" tone="muted">100줄, 한 쪽에 100줄: 아무것도 보이지 않습니다.</Text><PAGER total={100} initial={0} /></Stack>,
}

/** The filters in force: plain, a tag in its colour, and a 숨기기 pick (eye shut). */
export const Chips: Story = {
  render: () => (
    <Inline gap="condensed">
      <FilterChips chips={[
        { key: "status", label: "상태: 검토 필요", name: "상태", clear: () => {} },
        { key: "tag", label: "#옥상", name: "옥상", color: PALETTE[7].hex, clear: () => {} },
        { key: "hide", label: "화자: 민재", name: "민재", hidden: true, clear: () => {} },
      ]} />
    </Inline>
  ),
}
