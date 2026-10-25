import type { Meta, StoryObj } from "@storybook/react-vite"
import { Copy, Trash2 } from "lucide-react"
import { useState } from "react"
import { Stack } from "../primitives/stack"
import { Button } from "./button"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "./dropdown-menu"
import { MenuSearchField } from "./search-field"

const meta = { title: "Controls/DropdownMenu", component: DropdownMenu } satisfies Meta<typeof DropdownMenu>
export default meta
type Story = StoryObj<typeof meta>

const Trigger = ({ children = "메뉴" }: { children?: string }) => <DropdownMenuTrigger asChild><Button variant="outline">{children}</Button></DropdownMenuTrigger>

export const Default: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <Trigger />
      <DropdownMenuContent>
        <DropdownMenuLabel>대사</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem><Copy />복사<DropdownMenuShortcut>Ctrl C</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem disabled>붙여넣기</DropdownMenuItem>
          <DropdownMenuItem inset>들여쓴 항목</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 />삭제</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const CheckboxAndRadio: Story = {
  render: () => {
    const [checked, setChecked] = useState(true)
    const [value, setValue] = useState("draft")
    return (
      <DropdownMenu defaultOpen>
        <Trigger>필터</Trigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>확정된 줄 보기</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
            <DropdownMenuRadioItem value="draft">초벌 번역</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="review">검수 중</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  },
}

export const Submenu: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <Trigger />
      <DropdownMenuContent>
        <DropdownMenuItem>열기</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>상태 변경</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>초벌 번역</DropdownMenuItem>
            <DropdownMenuItem>검수 중</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** `width`: the menu names of the tokens, `trigger` (as wide as the button) or `fit`. */
export const Widths: Story = {
  render: () => (
    <Stack gap="condensed" align="start">
      {(["menu", "menu-lg", "trigger", "fit"] as const).map((width) => (
        <DropdownMenu key={width}>
          <Trigger>{width}</Trigger>
          <DropdownMenuContent width={width}><DropdownMenuItem>항목 하나</DropdownMenuItem><DropdownMenuItem>항목 둘</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      ))}
    </Stack>
  ),
}

/** `maxHeight` makes a long menu scroll; `padding="none"` for a menu that holds its own search field. */
export const ScrollingWithSearch: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <Trigger>긴 목록</Trigger>
      <DropdownMenuContent width="menu-lg" maxHeight="scroll-sm">
        <MenuSearchField placeholder="검색" />
        {Array.from({ length: 20 }, (_, index) => <DropdownMenuItem key={index}>등장인물 {index + 1}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const LongText: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <Trigger />
      <DropdownMenuContent width="menu"><DropdownMenuItem>아주 긴 이름의 항목이 좁은 메뉴에서 어떻게 보이는지 확인합니다</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
  ),
}
