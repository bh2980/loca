import type { Meta, StoryObj } from "@storybook/react-vite"
import { Stack } from "../primitives/stack"
import { Input } from "./input"
import { Label } from "./label"

const meta = { title: "Controls/Label", component: Label } satisfies Meta<typeof Label>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <Stack gap="condensed" width="field-lg"><Label htmlFor="l1">프로젝트 이름</Label><Input id="l1" /></Stack> }
/** A label beside a disabled control dims with it (`peer-disabled`). */
export const Disabled: Story = { render: () => <Stack gap="condensed" width="field-lg"><Input id="l2" className="peer" disabled /><Label htmlFor="l2">비활성 입력</Label></Stack> }
export const LongText: Story = { render: () => <Stack gap="condensed" width="field-sm"><Label htmlFor="l3">아주 긴 이름의 라벨은 좁은 폭에서 어떻게 보이는지 확인합니다</Label><Input id="l3" /></Stack> }
