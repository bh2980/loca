import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline } from "../primitives/stack"
import { Button } from "./button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "./alert-dialog"

const meta = { title: "Controls/AlertDialog", component: AlertDialog } satisfies Meta<typeof AlertDialog>
export default meta
type Story = StoryObj<typeof meta>

const Demo = ({ label, variant, title = "이 워크플로를 삭제할까요?" }: { label: string; variant?: "default" | "destructive" | "outline"; title?: string }) => (
  <AlertDialog>
    <AlertDialogTrigger asChild><Button variant="outline">{label}</Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>삭제하면 되돌릴 수 없습니다.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant={variant}>삭제</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

export const Default: Story = { render: () => <Demo label="삭제" /> }
export const ActionVariants: Story = { render: () => <Inline gap="condensed">{(["destructive", "default", "outline"] as const).map((variant) => <Demo key={variant} label={variant} variant={variant} />)}</Inline> }
export const LongText: Story = { render: () => <Demo label="긴 제목" title="아주 긴 제목의 확인 창은 좁은 폭에서 여러 줄로 감싸져야 하며 버튼과 겹치지 않아야 합니다" /> }
