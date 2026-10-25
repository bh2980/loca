import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Button } from "./button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog"

const meta = { title: "Controls/Dialog", component: Dialog } satisfies Meta<typeof Dialog>
export default meta
type Story = StoryObj<typeof meta>

const Demo = ({ label, ...props }: { label: string } & React.ComponentProps<typeof DialogContent>) => (
  <Dialog>
    <DialogTrigger asChild><Button variant="outline">{label}</Button></DialogTrigger>
    <DialogContent {...props}>
      <DialogHeader><DialogTitle>프로젝트 가져오기</DialogTitle><DialogDescription>파일을 선택하면 대사가 목록에 추가됩니다.</DialogDescription></DialogHeader>
      <Text variant="caption">{props.children ?? "내용"}</Text>
      <DialogFooter><Button variant="outline">취소</Button><Button>가져오기</Button></DialogFooter>
    </DialogContent>
  </Dialog>
)

export const Default: Story = { render: () => <Demo label="열기" /> }

/** `size` is the width it stops growing at. */
export const Sizes: Story = { render: () => <Inline gap="condensed">{(["sm", "md", "lg"] as const).map((size) => <Demo key={size} label={`size ${size}`} size={size} />)}</Inline> }

/** `tall`: a dialog that shows one thing large is a column as tall as the dialog limit. */
export const Tall: Story = { render: () => <Demo label="tall" tall /> }

export const WithoutCloseButton: Story = { render: () => <Demo label="닫기 버튼 없음" showCloseButton={false} /> }

export const LongText: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline">긴 제목</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>아주 긴 제목의 대화상자는 좁은 폭에서 여러 줄로 감싸지며 닫기 버튼과 겹치지 않아야 합니다</DialogTitle></DialogHeader>
        <DialogFooter><Button>확인</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
