import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline } from "../primitives/stack"
import { Button } from "./button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./sheet"

const meta = { title: "Controls/Sheet", component: Sheet } satisfies Meta<typeof Sheet>
export default meta
type Story = StoryObj<typeof meta>

const Demo = ({ label, ...props }: { label: string } & React.ComponentProps<typeof SheetContent>) => (
  <Sheet>
    <SheetTrigger asChild><Button variant="outline">{label}</Button></SheetTrigger>
    <SheetContent {...props}>
      <SheetHeader><SheetTitle>설정</SheetTitle><SheetDescription>프로젝트 설정을 바꿉니다.</SheetDescription></SheetHeader>
      <SheetFooter><Button>저장</Button></SheetFooter>
    </SheetContent>
  </Sheet>
)

export const Sides: Story = { render: () => <Inline gap="condensed">{(["right", "left", "top", "bottom"] as const).map((side) => <Demo key={side} label={side} side={side} />)}</Inline> }
export const WithoutCloseButton: Story = { render: () => <Demo label="닫기 버튼 없음" showCloseButton={false} /> }
