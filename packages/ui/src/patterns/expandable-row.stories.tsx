import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "../controls/button"
import { Box } from "../primitives/box"
import { Text } from "../primitives/text"
import { ExpandableRow } from "./expandable-row"

const meta = { title: "Patterns/ExpandableRow", component: ExpandableRow, decorators: [(Story) => <Box style={{ width: 360 }}><Story /></Box>] } satisfies Meta<typeof ExpandableRow>
export default meta
type Story = StoryObj<typeof meta>

/** Rows of a list, closed at first, a hairline between them, sizes at their end. */
export const Ruled: Story = {
  args: { summary: "지시문" },
  render: () => (
    <div>
      <ExpandableRow ruled summary={<Text weight="medium">지시문</Text>} meta="1,204자"><Text as="p">대사를 자연스러운 한국어로 옮기세요.</Text></ExpandableRow>
      <ExpandableRow ruled summary={<Text weight="medium">답 형식</Text>} meta="칸 3개"><Text as="p">translation · reason · confidence</Text></ExpandableRow>
      <ExpandableRow ruled summary={<Text weight="medium">아주 긴 이름은 줄을 바꿔 다 보이고 크기는 오른쪽 끝에 남습니다</Text>} meta="없음">내용</ExpandableRow>
    </div>
  ),
}

/** A small muted line inside other content. */
export const Inline: Story = { args: { size: "inline", summary: "입출력", children: <Text as="p" variant="caption">보낸 내용 2,400자</Text> } }

/** Only the chevron folds: the summary keeps its own buttons. */
export const ChevronToggle: Story = {
  args: { summary: "AI 번역" },
  render: () => (
    <ExpandableRow toggle="chevron" label="AI 번역 지시문 편집" summary={<><Text>AI 번역</Text><Text tone="muted" truncate>기본 프리셋에서 바꿈</Text></>} meta={<Button variant="ghost">되돌리기</Button>}>
      <Text as="p">지시문 편집칸</Text>
    </ExpandableRow>
  ),
}

export const Disabled: Story = { args: { toggle: "chevron", label: "펴기", disabled: true, summary: "빈 묶음" } }
