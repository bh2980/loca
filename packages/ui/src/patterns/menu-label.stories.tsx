import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "../controls/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../controls/dropdown-menu"
import { MenuLabel } from "./menu-label"

const meta = { title: "Patterns/MenuLabel", component: MenuLabel } satisfies Meta<typeof MenuLabel>
export default meta
type Story = StoryObj<typeof meta>

/** The three tones in one menu (click the button): muted, strong, quiet. */
export const Tones: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline">메뉴 열기</Button></DropdownMenuTrigger>
      <DropdownMenuContent>
        <MenuLabel tone="muted">보기</MenuLabel>
        <DropdownMenuItem>표로 보기</DropdownMenuItem>
        <MenuLabel tone="strong">정렬</MenuLabel>
        <DropdownMenuItem>대본 순서</DropdownMenuItem>
        <MenuLabel tone="quiet">필터 그룹 이름</MenuLabel>
        <DropdownMenuItem>검토 필요만</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
