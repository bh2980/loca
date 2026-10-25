import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Checkbox } from "../controls/checkbox"
import { Input } from "../controls/input"
import { Switch } from "../controls/switch"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Inline, Stack } from "../primitives/stack"
import { Field } from "./field"

const meta = { title: "Patterns/Field", decorators: [(Story) => <Box style={{ width: 360 }}><Story /></Box>] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A label over the control; the label is wired to the control without an id. */
export const Default: Story = {
  render: () => <Field label="프로젝트 이름"><Input placeholder="예: 하윤의 여름" /></Field>,
}

/** `description` says how to fill it in; `help` (the ?) says what the setting does. */
export const DescriptionAndHelp: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Field label="모델" description="비워 두면 연결의 기본 모델을 씁니다."><Input placeholder="gpt-6.1-sol" /></Field>
      <Field label="온도" help="높을수록 번역이 다양해지고, 낮을수록 같은 입력에 같은 결과가 나옵니다."><Input defaultValue="0.3" /></Field>
    </Stack>
  ),
}

/** An error replaces the description. */
export const WithError: Story = {
  render: () => (
    <Field label="정규식" description="JS 정규식 문법" error="괄호가 닫히지 않았습니다.">
      <Input aria-invalid defaultValue="^(하윤|민재" mono />
    </Field>
  ),
}

/** `action` sits right of the label (a small button or switch). */
export const WithAction: Story = {
  render: () => (
    <Field label="자동 확정" action={<Switch aria-label="자동 확정" />}>
      <Input defaultValue="검수 통과 시" />
    </Field>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Field label="서버 주소" description="연결을 만든 뒤에는 바꿀 수 없습니다."><Input disabled defaultValue="http://localhost:3000" /></Field>
  ),
}

export const LongText: Story = {
  render: () => (
    <Field label="아주 긴 라벨이 있는 필드의 이름이 한 줄에 다 들어가지 않을 때는 말줄임으로 잘립니다" description="설명은 한 줄 길이를 넘으면 다음 줄로 이어지며, 라벨처럼 잘리지 않고 그대로 보입니다.">
      <Input defaultValue="긴 값" />
    </Field>
  ),
}

/** `width` fixes the width by size name, for fields in a row. */
export const Widths: Story = {
  decorators: [(Story) => <Box style={{ width: 640 }}><Story /></Box>],
  render: () => (
    <Inline gap="comfortable" align="start">
      <Field label="이름" width="field"><Input defaultValue="하윤" /></Field>
      <Field label="나이" width="field-sm"><Input defaultValue="17" /></Field>
      <Field label="말투" width="field-lg"><Input defaultValue="친구에게는 반말" /></Field>
    </Inline>
  ),
}

/** The form family: a checkbox or switch before its label (`orientation="horizontal"`), grouped by `Field.Group`. */
export const Form: Story = {
  render: () => {
    const [on, setOn] = useState(true)
    return (
      <Field.Group>
        <Field>
          <Field.Label htmlFor="story-name">이름</Field.Label>
          <Input id="story-name" defaultValue="하윤" />
          <Field.Description>대본에서 쓰는 이름입니다.</Field.Description>
        </Field>
        <Field orientation="horizontal">
          <Switch id="story-auto" checked={on} onCheckedChange={setOn} />
          <Field.Content>
            <Field.Label htmlFor="story-auto">자동으로 번역</Field.Label>
            <Field.Description>새 줄이 들어오면 바로 번역합니다.</Field.Description>
          </Field.Content>
        </Field>
        <Field.Group nested lead>
          <Field orientation="horizontal">
            <Checkbox id="story-notes" />
            <Field.Label htmlFor="story-notes" variant="choice">메모도 함께 보내기</Field.Label>
          </Field>
        </Field.Group>
      </Field.Group>
    )
  },
}

/** Form errors: a message, or a list when several. */
export const FormErrors: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Field data-invalid="true">
        <Field.Label htmlFor="story-key">키</Field.Label>
        <Input id="story-key" aria-invalid defaultValue="" />
        <Field.Error>키를 입력하세요.</Field.Error>
      </Field>
      <Field.Error errors={[{ message: "이름이 비어 있습니다." }, { message: "이미 있는 이름입니다." }]} />
    </Stack>
  ),
}

/** `Field.Set` switches off every field it holds with `disabled`; `Field.Group` has two gaps. */
export const SetAndGaps: Story = {
  render: () => (
    <Stack gap="comfortable">
      <Field.Set disabled>
        <Field.Group>
          <Field label="이름"><Input defaultValue="하윤" /></Field>
          <Field label="설명"><Input defaultValue="주인공" /></Field>
        </Field.Group>
      </Field.Set>
      <Field.Group gap="wide">
        <Field label="이름"><Input defaultValue="하윤" /></Field>
        <Field label="설명"><Input defaultValue="주인공" /></Field>
      </Field.Group>
      <Button variant="outline">저장</Button>
    </Stack>
  ),
}
