import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Stack } from "../primitives/stack"
import { Combobox, type ComboboxOption } from "./combobox"

const meta = { title: "Controls/Combobox" } satisfies Meta
export default meta
type Story = StoryObj

const OPTIONS: ComboboxOption[] = [
  { value: "minah", label: "민아", searchText: "mina" },
  { value: "junho", label: "준호", searchText: "junho" },
  { value: "seoyeon", label: "서연" },
  { value: "long", label: "아주 긴 이름의 등장인물이 목록과 버튼에서 어떻게 보이는지 확인하는 항목" },
]
const MANY: ComboboxOption[] = Array.from({ length: 200 }, (_, index) => ({ value: `c${index}`, label: `등장인물 ${index + 1}` }))

function Controlled({ options = OPTIONS, ...props }: Partial<Parameters<typeof Combobox>[0]>) {
  const [value, setValue] = useState<string | undefined>(props.value)
  return <Combobox ariaLabel="등장인물" {...props} options={options} value={value} onValueChange={setValue} />
}

export const Default: Story = { render: () => <Controlled /> }
export const Selected: Story = { render: () => <Controlled value="minah" /> }
export const Disabled: Story = { render: () => <Controlled value="minah" disabled /> }
export const LongText: Story = { render: () => <Stack width="field-lg"><Controlled value="long" /></Stack> }
export const EmptyResult: Story = { render: () => <Controlled options={[]} emptyText="등장인물이 없습니다" placeholder="인물 선택" /> }
/** Only the first fifty matches are mounted. */
export const ManyOptions: Story = { render: () => <Controlled options={MANY} /> }
/** Searched elsewhere: the chosen value shows its `selectedLabel` though it is not among the matches. */
export const SearchedElsewhere: Story = { render: () => <Controlled value="far" selectedLabel="목록 밖의 인물" onSearch={() => {}} /> }
