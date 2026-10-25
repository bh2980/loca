import type { Meta, StoryObj } from "@storybook/react-vite"
import { AlertTriangle, Info } from "lucide-react"
import { Button } from "../controls/button"
import { Input } from "../controls/input"
import { Box } from "../primitives/box"
import { Icon } from "../primitives/icon"
import { Stack } from "../primitives/stack"
import { Notice, NoticeDescription, NoticeRow } from "./notice"

const meta = { title: "Patterns/Notice", component: Notice, decorators: [(Story) => <Box style={{ width: 440 }}><Story /></Box>] } satisfies Meta<typeof Notice>
export default meta
type Story = StoryObj<typeof meta>

/** In the flow: neutral holds what waits for a decision, warning and danger are one message. */
export const Inline: Story = {
  render: () => (
    <Stack gap="condensed">
      <Notice><Box as="p">제안 3건이 승인을 기다립니다.</Box><Box as="p">승인하면 번역이 바뀝니다.</Box></Notice>
      <Notice tone="warning" as="p">연결이 불안정해 일부 줄이 늦어질 수 있습니다.</Notice>
      <Notice tone="danger" as="p">번역을 저장하지 못했습니다. 다시 시도해 주세요.</Notice>
    </Stack>
  ),
}

/** A row above a form: what happened, and the choices at its end. */
export const Banner: Story = {
  render: () => (
    <Stack gap="condensed">
      {(["neutral", "warning", "danger"] as const).map((tone) => (
        <Notice key={tone} tone={tone} variant="banner" actions={<><Button variant="outline">무시</Button><Button>다시 불러오기</Button></>}>
          다른 곳에서 이 줄이 바뀌었습니다.
        </Notice>
      ))}
    </Stack>
  ),
}

/** The alert layout: an icon, a title, a description, and a row of controls. */
export const Titled: Story = {
  render: () => (
    <Stack gap="condensed">
      <Notice icon={<Icon icon={Info} />} title="연결을 확인하세요">
        <NoticeDescription>모델 서버에 닿지 않았습니다.<Box as="p">주소와 키를 확인한 뒤 다시 시도하세요.</Box></NoticeDescription>
        <NoticeRow><Input placeholder="서버 주소" /><Button variant="outline">다시 시도</Button></NoticeRow>
      </Notice>
      <Notice tone="warning" icon={<Icon icon={AlertTriangle} />} title="아주 긴 제목은 한 줄로 잘립니다 아주 긴 제목은 한 줄로 잘립니다 아주 긴 제목">
        <NoticeDescription>경고 톤의 설명은 한 단계 옅게 보입니다.</NoticeDescription>
      </Notice>
      <Notice tone="danger" icon={<Icon icon={AlertTriangle} />} title="실패"><NoticeDescription>호출이 거부되었습니다.</NoticeDescription></Notice>
    </Stack>
  ),
}

/** `window`: bottom of the window, quiet; `canvas`: top middle of a canvas, never takes a click. */
export const Floating: Story = {
  decorators: [(Story) => <Box style={{ width: 440, height: 160 }} position="relative" border="all" radius="md"><Story /></Box>],
  render: () => <Notice variant="floating" placement="canvas">보기만 가능합니다</Notice>,
}

export const FloatingWindow: Story = {
  render: () => <Notice variant="floating" placement="window">저장했습니다</Notice>,
}

export const LongText: Story = {
  render: () => <Notice tone="warning" as="p">아주 긴 경고 문장은 상자 안에서 줄이 바뀌며, 상자는 내용만큼 늘어납니다. 아주 긴 경고 문장은 상자 안에서 줄이 바뀝니다.</Notice>,
}
