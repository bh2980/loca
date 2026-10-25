import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Text } from "../primitives/text"
import { Card, CardDescription, CardHeader, CardTitle } from "./card"

const meta = { title: "Patterns/Card", component: Card, decorators: [(Story) => <Box style={{ width: 360 }}><Story /></Box>] } satisfies Meta<typeof Card>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>번역 워크플로</CardTitle>
        <CardDescription>미번역 줄을 번역하고 검토 필요로 넘깁니다.</CardDescription>
      </CardHeader>
    </Card>
  ),
}

/** The header grows a second column when it holds a `data-slot="card-action"`. */
export const WithAction: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>번역 워크플로</CardTitle>
        <CardDescription>미번역 줄을 번역하고 검토 필요로 넘깁니다.</CardDescription>
        <Box data-slot="card-action"><Button variant="outline">실행</Button></Box>
      </CardHeader>
    </Card>
  ),
}

export const LongText: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>아주 긴 카드 제목은 폭을 넘으면 다음 줄로 이어집니다 아주 긴 카드 제목</CardTitle>
        <CardDescription>설명도 길어지면 줄이 바뀌며, 카드는 내용만큼 늘어납니다. 설명도 길어지면 줄이 바뀝니다.</CardDescription>
      </CardHeader>
      <Box paddingX="roomy"><Text variant="body">카드의 본문은 호출하는 쪽이 채웁니다.</Text></Box>
    </Card>
  ),
}
