import type { Meta, StoryObj } from "@storybook/react-vite"
import { EyeOff, ListFilter } from "lucide-react"
import { useState } from "react"
import { Box } from "../layout/box"
import { Inline } from "../layout/stack"
import { Text } from "../primitives/text"
import { FilterCheck, FilterHeaderButton, FilterSegmentedBar } from "./filter-parts"

const meta = { title: "Data/Filter header" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A column header that filters its column: plain, then with a filter in force. */
export const Header: Story = {
  render: () => (
    <Inline gap="comfortable">
      <FilterHeaderButton label="상태" active={false} aria-label="상태 필터" />
      <FilterHeaderButton label="상태" active aria-label="상태 필터" />
    </Inline>
  ),
}

/** The show / hide switch at the top of a filter menu, and a picked and an unpicked row. */
export const ModeSwitch: Story = {
  render: () => {
    const [mode, setMode] = useState("show")
    return (
      <Box style={{ width: 256 }} spaceY="condensed">
        <FilterSegmentedBar
          ariaLabel="필터 방식"
          value={mode}
          onChange={setMode}
          items={[
            { value: "show", label: <><ListFilter aria-hidden="true" />이것만 보기</> },
            { value: "hide", label: <><EyeOff aria-hidden="true" />숨기기</> },
          ]}
        />
        <Inline gap="condensed"><FilterCheck on /><Text>번역 완료</Text></Inline>
        <Inline gap="condensed"><FilterCheck on={false} /><Text>검수 필요</Text></Inline>
      </Box>
    )
  },
}
