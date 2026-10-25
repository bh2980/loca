import type { Meta, StoryObj } from "@storybook/react-vite"
import { EyeOff, ListFilter } from "lucide-react"
import { useState } from "react"
import { Box } from "../primitives/box"
import { Inline } from "../primitives/stack"
import { Text } from "../primitives/text"
import { SegmentedControl } from "../controls/segmented-control"
import { FilterCheck, FilterHeaderButton } from "./filter-parts"

const meta = { title: "Patterns/FilterParts" } satisfies Meta
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
        <SegmentedControl
          fill
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

/** The tick keeps its room when off, so labels line up. */
export const Check: Story = {
  render: () => <Inline gap="comfortable"><FilterCheck on /><FilterCheck on={false} /></Inline>,
}

/** The header is a trigger: it takes the props of a button, disabled included. */
export const DisabledHeader: Story = {
  render: () => <FilterHeaderButton label="상태" active={false} disabled aria-label="상태 필터" />,
}

export const LongHeader: Story = {
  render: () => <Box style={{ width: 140 }} overflow="hidden"><FilterHeaderButton label="아주 긴 열 이름의 필터" active aria-label="필터" /></Box>,
}
