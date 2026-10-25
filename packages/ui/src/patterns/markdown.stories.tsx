import type { Meta, StoryObj } from "@storybook/react-vite"
import { Box } from "../primitives/box"
import { Markdown } from "./markdown"

const meta = { title: "Patterns/Markdown", component: Markdown, decorators: [(Story) => <Box style={{ width: 380 }}><Story /></Box>] } satisfies Meta<typeof Markdown>
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

export const Empty: Story = { args: { children: "" } }

const WIDE = `| 용어 | 원문 | 번역 | 근거 | 비고 |
| --- | --- | --- | --- | --- |
| 하윤 | ハユン | 하윤 | 12-004, 12-018, 12-044 | 주인공, 이름은 음차로 고정 |`

/** A wide table scrolls sideways inside its own box. */
export const WideTable: Story = { args: { children: WIDE } }

/** An image is a link to the picture (opened in a new tab), not inlined at full size. */
export const Image: Story = { args: { children: "![스크린샷](data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22160%22%20height%3D%22100%22%3E%3Crect%20width%3D%22160%22%20height%3D%22100%22%20fill-opacity%3D%220.3%22%2F%3E%3C%2Fsvg%3E)" } }
