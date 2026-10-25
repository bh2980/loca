import type { Meta, StoryObj } from "@storybook/react-vite"
import { PALETTE } from "@tw/shared"
import { useState } from "react"
import { Button } from "../controls/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../controls/dropdown-menu"
import { Stack } from "../primitives/stack"
import { Text } from "../primitives/text"
import { TagListEditor, TagMenu, TagSubMenu, type TagState } from "./tag-menu"

const meta = { title: "Patterns/TagMenu" } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const TAGS: { id: string; name: string; color: string; role?: string }[] = [
  { id: "roof", name: "옥상", color: PALETTE[7].hex },
  { id: "flash", name: "회상", color: PALETTE[9].hex },
  { id: "joke", name: "농담", color: PALETTE[3].hex },
  { id: "auto", name: "자동", color: PALETTE[0].hex, role: "system" },
]

function useTagState(initial: Record<string, TagState>) {
  const [states, setStates] = useState(initial)
  return { state: (id: string) => states[id] ?? "none", toggle: (id: string, add: boolean) => setStates((previous) => ({ ...previous, [id]: add ? "all" : "none" })) }
}

/** All / some / none: a checked row, a "일부" mark, an unchecked row. Click the button. */
export const Menu: Story = {
  render: () => {
    const { state, toggle } = useTagState({ roof: "all", flash: "some" })
    return <TagMenu tags={TAGS} state={state} onToggle={toggle} heading="선택한 3줄의 태그" triggerLabel="태그" />
  },
}

/** With `onCreate` the menu ends in a new-tag field. */
export const Create: Story = {
  render: () => {
    const { state, toggle } = useTagState({})
    const [tags, setTags] = useState(TAGS.slice(0, 2))
    return <TagMenu tags={tags} state={state} onToggle={toggle} heading="태그" onCreate={(name) => setTags((previous) => [...previous, { id: name, name, color: PALETTE[6].hex }])} />
  },
}

/** No tags yet: the menu says so and offers to make one. Without tags or `onCreate` it renders nothing. */
export const Empty: Story = {
  render: () => {
    const { state, toggle } = useTagState({})
    return (
      <Stack gap="condensed" align="start">
        <TagMenu tags={[]} state={state} onToggle={toggle} heading="태그" onCreate={() => {}} />
        <Text variant="caption" tone="muted">태그도 만들기도 없으면 아무것도 보이지 않습니다:</Text>
        <TagMenu tags={[]} state={state} onToggle={toggle} heading="태그" />
      </Stack>
    )
  },
}

/** The same picker as a submenu of another menu (a line's ⋯ menu). */
export const SubMenu: Story = {
  render: () => {
    const { state, toggle } = useTagState({ roof: "all" })
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline">⋯ 메뉴</Button></DropdownMenuTrigger>
        <DropdownMenuContent>
          <TagSubMenu tags={TAGS} state={state} onToggle={toggle} heading="태그" />
          <TagSubMenu tags={TAGS} state={state} onToggle={toggle} heading="태그" label="태그 (아이콘 없음)" icon={false} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  },
}

/** An item's tags with × to remove (system tags have none) and a + button; `readOnly` shows them only. */
export const ListEditor: Story = {
  render: () => {
    const [attached, setAttached] = useState(["roof", "auto"])
    const toggle = (id: string, add: boolean) => setAttached((previous) => (add ? [...previous, id] : previous.filter((item) => item !== id)))
    const tags = TAGS.filter((tag) => attached.includes(tag.id))
    return (
      <Stack gap="comfortable" align="start">
        <TagListEditor tags={tags} allTags={TAGS} onToggle={toggle} onCreate={() => {}} />
        <TagListEditor tags={tags} allTags={TAGS} onToggle={toggle} readOnly />
        <TagListEditor tags={[]} allTags={TAGS} onToggle={toggle} />
      </Stack>
    )
  },
}
