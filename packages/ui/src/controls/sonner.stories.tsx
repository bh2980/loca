import type { Meta, StoryObj } from "@storybook/react-vite"
import { toast } from "sonner"
import { Inline } from "../primitives/stack"
import { Button } from "./button"
import { Toaster } from "./sonner"

const meta = { title: "Controls/Toast", component: Toaster } satisfies Meta<typeof Toaster>
export default meta
type Story = StoryObj<typeof meta>

export const Kinds: Story = {
  render: () => (
    <>
      <Toaster />
      <Inline gap="condensed">
        <Button variant="outline" onClick={() => toast("저장했습니다")}>기본</Button>
        <Button variant="outline" onClick={() => toast.success("번역을 마쳤습니다")}>성공</Button>
        <Button variant="outline" onClick={() => toast.info("새 버전이 있습니다")}>안내</Button>
        <Button variant="outline" onClick={() => toast.warning("일부 줄을 건너뛰었습니다")}>경고</Button>
        <Button variant="outline" onClick={() => toast.error("연결이 끊겼습니다")}>오류</Button>
        <Button variant="outline" onClick={() => toast.loading("번역 중…")}>진행 중</Button>
      </Inline>
    </>
  ),
}

export const LongText: Story = {
  render: () => (
    <>
      <Toaster />
      <Button variant="outline" onClick={() => toast.error("아주 긴 오류 메시지가 토스트 안에서 여러 줄로 감싸집니다. 아주 긴 오류 메시지가 토스트 안에서 여러 줄로 감싸집니다.", { description: "자세한 설명이 이어서 보입니다." })}>긴 메시지</Button>
    </>
  ),
}
