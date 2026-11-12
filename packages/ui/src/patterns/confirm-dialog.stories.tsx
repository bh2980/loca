import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "../controls/button"
import { Input } from "../controls/input"
import { Inline } from "../primitives/stack"
import { ConfirmDialog } from "./confirm-dialog"

const meta = { title: "Patterns/ConfirmDialog", component: ConfirmDialog } satisfies Meta<typeof ConfirmDialog>
export default meta
type Story = StoryObj<typeof meta>

const base = { title: "용어를 삭제할까요?", description: "“등대” 용어가 용어집에서 사라집니다. 이미 번역된 대사는 바뀌지 않습니다.", onConfirm: () => {} }

/** Opened by its own button. */
export const WithTrigger: Story = { args: { ...base, trigger: <Button variant="ghost" tone="danger">용어 삭제</Button> } }

/** Opened from elsewhere (a row's menu): open while the subject is set, and the wording stays while it closes. */
export const Controlled: Story = {
  args: base,
  render: () => {
    const [target, setTarget] = useState<string | null>(null)
    return (
      <Inline gap="condensed">
        <Button variant="outline" onClick={() => setTarget("1장 초벌")}>‘1장 초벌’ 삭제</Button>
        <ConfirmDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)} title={`‘${target}’을 삭제할까요?`} description="지난 실행 기록은 남습니다." onConfirm={() => setTarget(null)} />
      </Inline>
    )
  },
}

/** A field the confirmation needs; the dialog stays until the caller closes it. */
export const WithField: Story = {
  args: base,
  render: () => {
    const [name, setName] = useState("")
    return (
      <ConfirmDialog trigger={<Button variant="destructive">프로젝트 삭제</Button>} title="프로젝트를 삭제할까요?" description="계속하려면 프로젝트 이름 “등대”을(를) 입력하세요." keepOpen disabled={name !== "등대"} onConfirm={() => {}}>
        <Input aria-label="프로젝트 이름 확인" value={name} onChange={(event) => setName(event.target.value)} placeholder="등대" />
      </ConfirmDialog>
    )
  },
}

export const Pending: Story = { args: { ...base, trigger: <Button variant="outline">삭제 중</Button>, pending: true, confirmLabel: "삭제 중…" } }
export const OtherWording: Story = { args: { ...base, trigger: <Button variant="outline">실행 취소</Button>, title: "실행을 취소할까요?", description: "아직 처리하지 않은 대사는 이 실행에서 빠집니다.", confirmLabel: "실행 취소", cancelLabel: "계속 실행" } }
