import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../layout/box"
import { ChatMarkdown } from "./markdown"

const meta = { title: "Chat/Markdown", component: ChatMarkdown, decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta<typeof ChatMarkdown>
export default meta
type Story = StoryObj<typeof meta>

const TEXT = `## 말투 규칙

하윤은 **친구에게는 반말**, 선생님에게는 ~~반말~~ 존댓말을 씁니다.

1. 짧게 끊어 말한다
2. 감탄사를 자주 쓴다

- [x] 1장 확인
- [ ] 2장 확인

> 옥상 장면은 존댓말에서 반말로 넘어갑니다.

| 대상 | 말투 | 근거 |
| --- | --- | --- |
| 민재 | 반말 | 12-004 |
| 선생님 | 존댓말 | 03-011 |

\`speech_rule\` 키로 저장했습니다.`

export const Reply: Story = { args: { children: TEXT } }

/** A preview of text an agent proposes to save: in a scrolling frame. */
export const Framed: Story = { args: { children: TEXT, framed: true } }
