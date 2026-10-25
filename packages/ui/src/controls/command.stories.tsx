import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Box } from "../primitives/box"
import { Button } from "./button"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "./command"

const meta = { title: "Controls/Command", component: Command } satisfies Meta<typeof Command>
export default meta
type Story = StoryObj<typeof meta>

const Items = () => (
  <CommandList>
    <CommandEmpty>검색 결과가 없습니다</CommandEmpty>
    <CommandGroup heading="이동">
      <CommandItem>대사 목록<CommandShortcut>Ctrl 1</CommandShortcut></CommandItem>
      <CommandItem>인물·관계</CommandItem>
      <CommandItem disabled>비활성 항목</CommandItem>
    </CommandGroup>
    <CommandSeparator />
    <CommandGroup heading="실행">
      <CommandItem>아주 긴 이름의 명령이 목록에서 어떻게 보이는지 확인하는 항목입니다 아주 긴 이름</CommandItem>
    </CommandGroup>
  </CommandList>
)

export const Default: Story = {
  render: () => (
    <Box width="menu-xl" border="all" radius="md">
      <Command><CommandInput placeholder="명령 검색" /><Items /></Command>
    </Box>
  ),
}

export const Empty: Story = {
  render: () => (
    <Box width="menu-xl" border="all" radius="md">
      <Command><CommandInput placeholder="명령 검색" defaultValue="없는 명령" /><Items /></Command>
    </Box>
  ),
}

export const InDialog: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>명령 팔레트 열기</Button>
        <CommandDialog open={open} onOpenChange={setOpen} title="명령 팔레트" description="실행할 명령을 검색합니다">
          <CommandInput placeholder="명령 검색" /><Items />
        </CommandDialog>
      </>
    )
  },
}
