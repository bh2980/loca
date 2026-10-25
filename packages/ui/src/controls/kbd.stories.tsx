import type { Meta, StoryObj } from "@storybook/react-vite"
import { Inline } from "../primitives/stack"
import { Text } from "../primitives/text"
import { Kbd, KbdGroup } from "./kbd"

const meta = { title: "Controls/Kbd", component: Kbd } satisfies Meta<typeof Kbd>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <Kbd>Esc</Kbd> }
export const Group: Story = { render: () => <KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup> }
export const InText: Story = { render: () => <Inline gap="condensed"><Text variant="caption">검색은</Text><KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup><Text variant="caption">로 엽니다</Text></Inline> }
